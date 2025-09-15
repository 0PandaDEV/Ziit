import { prisma } from "~~/prisma/prisma";
import { decrypt, encrypt } from "paseto-ts/v4";
import { handleApiError } from "~~/server/utils/logging";

defineRouteMeta({
  openAPI: {
    tags: ["Auth", "GitHub"],
    summary: "GitHub OAuth callback",
    description:
      "Handles GitHub OAuth callback. Exchanges code for access token, signs in or links account, and redirects.",
    parameters: [
      { in: "query", name: "code", required: true, schema: { type: "string" } },
      {
        in: "query",
        name: "state",
        required: true,
        schema: { type: "string" },
      },
    ],
    responses: {
      302: { description: "Redirect to application after login/link" },
      400: { description: "Missing or invalid parameters" },
      500: { description: "Authentication failure" },
    },
    operationId: "getGithubCallback",
  },
});

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
  const code = query.code as string;
  const state = query.state as string;

  if (!code) {
    throw handleApiError(
      400,
      "GitHub callback error: No authorization code provided.",
    );
  }

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
      throw handleApiError(
        69,
        `GitHub callback error: No primary email found for GitHub user ID ${githubUser.id}. Emails received: ${JSON.stringify(emails)}`,
        "Could not retrieve email from GitHub",
      );
    }

    if (isLinking && linkSession) {
      try {
        const { payload } = decrypt(config.pasetoKey, linkSession);

        if (
          typeof payload === "object" &&
          payload !== null &&
          "userId" in payload
        ) {
          const userId = payload.userId;
          let redirectUrl = "/settings?success=github_linked";

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

              redirectUrl = "/settings?success=accounts_merged";
            } else if (currentUser?.githubId === githubUser.id.toString()) {
              await tx.user.update({
                where: { id: userId },
                data: {
                  githubAccessToken: accessToken,
                },
              });
              redirectUrl = "/settings?success=github_updated";
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
        return sendRedirect(event, "/settings?error=link_failed");
      }
    }

    await prisma.$transaction(async (tx) => {
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
              lastlogin: new Date(),
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
              lastlogin: new Date(),
            },
          });
        }
      } else {
        user = await tx.user.update({
          where: { id: user.id },
          data: {
            githubAccessToken: accessToken,
            lastlogin: new Date(),
          },
        });
      }

      const token = encrypt(config.pasetoKey, {
        userId: user.id,
        exp: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      });

      setCookie(event, "ziit_session", token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        maxAge: 60 * 60 * 24 * 7,
        path: "/",
        sameSite: "lax",
      });

      return user;
    });

    setHeader(event, "Cache-Control", "no-cache, no-store, must-revalidate");
    setHeader(event, "Pragma", "no-cache");
    setHeader(event, "Expires", "0");

    return sendRedirect(event, "/");
  } catch (error) {
    const detailedMessage =
      error instanceof Error
        ? error.message
        : "An unknown error occurred during GitHub authentication.";
    throw handleApiError(
      69,
      `GitHub authentication failed: ${detailedMessage}`,
      "GitHub authentication failed. Please try again.",
    );
  }
});
