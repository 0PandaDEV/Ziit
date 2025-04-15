import { prisma } from "~~/prisma/prisma";
import jwt from "jsonwebtoken";

interface GithubTokenResponse {
  access_token: string;
  refresh_token?: string;
  scope: string;
  token_type: string;
}

interface GithubUser {
  id: number;
  login: string;
  name: string;
  email: string;
}

interface GithubEmail {
  email: string;
  primary: boolean;
  verified: boolean;
  visibility: string;
}

export default defineEventHandler(async (event) => {
  const config = useRuntimeConfig();
  const query = getQuery(event);

  const state = query.state as string;
  const storedState = getCookie(event, "github_oauth_state");

  if (!state || state !== storedState) {
    return sendRedirect(event, "/login?error=invalid_state");
  }

  const isLinking = getCookie(event, "github_link_account") === "true";
  const linkSession = getCookie(event, "github_link_session");

  deleteCookie(event, "github_oauth_state");
  deleteCookie(event, "github_link_account");
  deleteCookie(event, "github_link_session");

  const code = query.code as string;
  if (!code) {
    return sendRedirect(event, "/login?error=no_code");
  }

  try {
    const tokenResponse = await $fetch<GithubTokenResponse>(
      "https://github.com/login/oauth/access_token",
      {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          client_id: config.githubClientId,
          client_secret: config.githubClientSecret,
          code,
          redirect_uri: config.githubRedirectUri,
        }),
      }
    );

    const accessToken = tokenResponse.access_token;

    const githubUser = await $fetch<GithubUser>("https://api.github.com/user", {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/vnd.github.v3+json",
      },
    });

    const emails = await $fetch<GithubEmail[]>(
      "https://api.github.com/user/emails",
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: "application/vnd.github.v3+json",
        },
      }
    );

    const primaryEmail =
      emails.find((email) => email.primary)?.email || emails[0]?.email;

    if (!primaryEmail) {
      return sendRedirect(event, "/login?error=no_email");
    }

    if (isLinking && linkSession) {
      try {
        const decoded = jwt.verify(linkSession, config.jwtSecret);
        if (
          typeof decoded === "object" &&
          decoded !== null &&
          "userId" in decoded
        ) {
          const userId = decoded.userId;

          const existingGithubUser = await prisma.user.findFirst({
            where: { githubId: githubUser.id.toString() },
          });

          const currentUser = await prisma.user.findUnique({
            where: { id: userId },
          });

          if (existingGithubUser && existingGithubUser.id !== userId) {
            await prisma.heartbeats.updateMany({
              where: { userId: existingGithubUser.id },
              data: { userId: userId },
            });

            await prisma.user.delete({
              where: { id: existingGithubUser.id },
            });

            await prisma.user.update({
              where: { id: userId },
              data: {
                githubId: githubUser.id.toString(),
                githubUsername: githubUser.login,
                githubAccessToken: accessToken,
              },
            });

            return sendRedirect(event, "/profile?success=accounts_merged");
          }

          if (currentUser?.githubId === githubUser.id.toString()) {
            await prisma.user.update({
              where: { id: userId },
              data: {
                githubAccessToken: accessToken,
              },
            });
            return sendRedirect(event, "/profile?success=github_updated");
          }

          await prisma.user.update({
            where: { id: userId },
            data: {
              githubId: githubUser.id.toString(),
              githubUsername: githubUser.login,
              githubAccessToken: accessToken,
            },
          });

          return sendRedirect(event, "/profile?success=github_linked");
        }
      } catch (error) {
        console.error("Error linking GitHub account:", error);
        return sendRedirect(event, "/profile?error=link_failed");
      }
    }

    let user = await prisma.user.findFirst({
      where: { githubId: githubUser.id.toString() },
    });

    if (!user) {
      user = await prisma.user.findUnique({
        where: { email: primaryEmail },
      });

      if (user) {
        user = await prisma.user.update({
          where: { id: user.id },
          data: {
            githubId: githubUser.id.toString(),
            githubUsername: githubUser.login,
            githubAccessToken: accessToken,
          },
        });
      } else {
        user = await prisma.user.create({
          data: {
            email: primaryEmail,
            passwordHash: null,
            githubId: githubUser.id.toString(),
            githubUsername: githubUser.login,
            githubAccessToken: accessToken,
          },
        });
      }
    } else {
      user = await prisma.user.update({
        where: { id: user.id },
        data: {
          githubAccessToken: accessToken,
        },
      });
    }

    const token = jwt.sign({ userId: user.id }, config.jwtSecret, {
      expiresIn: "7d",
    });

    setCookie(event, "ziit_session", token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      maxAge: 60 * 60 * 24 * 7,
      path: "/",
    });

    return sendRedirect(event, "/");
  } catch (error) {
    console.error("GitHub OAuth error:", error);
    return sendRedirect(event, "/login?error=github_auth_failed");
  }
});
