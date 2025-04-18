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
    console.error("GitHub Callback error: Invalid state");
    return sendRedirect(event, "/login?error=invalid_state");
  }

  const isLinking = getCookie(event, "github_link_account") === "true";
  const linkSession = getCookie(event, "github_link_session");

  deleteCookie(event, "github_oauth_state");
  deleteCookie(event, "github_link_account");
  deleteCookie(event, "github_link_session");

  const code = query.code as string;
  if (!code) {
    console.error("GitHub Callback error: No code provided");
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
      },
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
      },
    );

    const primaryEmail =
      emails.find((email) => email.primary)?.email || emails[0]?.email;

    if (!primaryEmail) {
      console.error("GitHub Callback error: No primary email found");
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
          let redirectUrl = "/profile?success=github_linked";

          await prisma.$transaction(async (tx) => {
            const [existingGithubUser, currentUser] = await Promise.all([
              tx.user.findFirst({
                where: { githubId: githubUser.id.toString() },
              }),
              tx.user.findUnique({
                where: { id: userId },
              }),
            ]);

            if (existingGithubUser && existingGithubUser.id !== userId) {
              await Promise.all([
                tx.heartbeats.updateMany({
                  where: { userId: existingGithubUser.id },
                  data: { userId: userId },
                }),
                tx.summaries.updateMany({
                  where: { userId: existingGithubUser.id },
                  data: { userId: userId },
                }),
                tx.user.delete({
                  where: { id: existingGithubUser.id },
                }),
                tx.user.update({
                  where: { id: userId },
                  data: {
                    githubId: githubUser.id.toString(),
                    githubUsername: githubUser.login,
                    githubAccessToken: accessToken,
                  },
                }),
              ]);

              redirectUrl = "/profile?success=accounts_merged";
            } else if (currentUser?.githubId === githubUser.id.toString()) {
              await tx.user.update({
                where: { id: userId },
                data: {
                  githubAccessToken: accessToken,
                },
              });
              redirectUrl = "/profile?success=github_updated";
            } else {
              await tx.user.update({
                where: { id: userId },
                data: {
                  githubId: githubUser.id.toString(),
                  githubUsername: githubUser.login,
                  githubAccessToken: accessToken,
                },
              });
            }
          });

          return sendRedirect(event, redirectUrl);
        }
      } catch {
        return sendRedirect(event, "/profile?error=link_failed");
      }
    }

    const result = await prisma.$transaction(async (tx) => {
      let user = await tx.user.findFirst({
        where: { githubId: githubUser.id.toString() },
      });

      if (!user) {
        user = await tx.user.findUnique({
          where: { email: primaryEmail },
        });

        if (user) {
          user = await tx.user.update({
            where: { id: user.id },
            data: {
              githubId: githubUser.id.toString(),
              githubUsername: githubUser.login,
              githubAccessToken: accessToken,
            },
          });
        } else {
          user = await tx.user.create({
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
        user = await tx.user.update({
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
        sameSite: "lax",
      });

      return "/";
    });

    return sendRedirect(event, result);
  } catch {
    console.error("GitHub OAuth error");
    return sendRedirect(event, "/login?error=github_auth_failed");
  }
});
