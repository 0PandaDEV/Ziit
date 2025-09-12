import { prisma } from "~~/prisma/prisma";
import { decrypt, encrypt } from "paseto-ts/v4";
import { handleApiError } from "~~/server/utils/logging";

defineRouteMeta({
  openAPI: {
    tags: ["Auth", "Epilogue"],
    summary: "Epilogue OAuth callback",
    description:
      "Handles Epilogue OAuth callback. Exchanges code for access token, signs in or links account, and redirects.",
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
    operationId: "getEpilogueCallback",
  },
});

interface EpilogueUser {
  id: string;
  username?: string;
  email?: string;
}

export default defineEventHandler(async (event) => {
  const config = useRuntimeConfig();
  const query = getQuery(event);
  const code = query.code as string;

  if (!code) {
    return sendRedirect(event, "/login?error=cancelled");
  }

  const storedState = getCookie(event, "epilogue_oauth_state");

  if (!storedState) {
    return sendRedirect(event, "/login?error=invalid_state");
  }

  const isLinking = getCookie(event, "epilogue_link_account") === "true";
  const linkSession = getCookie(event, "epilogue_link_session");

  deleteCookie(event, "epilogue_oauth_state");
  deleteCookie(event, "epilogue_link_account");
  deleteCookie(event, "epilogue_link_session");

  try {
    const tokenResponse = await $fetch<{ token: string }>(
      `https://auth.epilogue.team/api/v1/authorize/${config.epilogueAppId}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          authorizationCode: code,
          applicationSecret: config.epilogueAppSecret,
        }),
      }
    );

    const accessToken = tokenResponse.token;

    const epilogueUser = await $fetch<EpilogueUser>(
      "https://auth.epilogue.team/api/v1/app/me",
      {
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
      }
    );

    if (!epilogueUser || !epilogueUser.id) {
      throw handleApiError(
        69,
        `Epilogue callback error: Invalid user data received`,
        "Could not retrieve user information from Epilogue"
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
          let redirectUrl = "/settings?success=epilogue_linked";

          await prisma.$transaction(async (tx) => {
            const [existingEpilogueUser, currentUser] = await Promise.all([
              tx.user.findFirst({
                where: { epilogueId: epilogueUser.id },
              }),
              tx.user.findUnique({
                where: { id: userId },
              }),
            ]);

            if (existingEpilogueUser && existingEpilogueUser.id !== userId) {
              await Promise.all([
                tx.heartbeats.updateMany({
                  where: { userId: existingEpilogueUser.id },
                  data: { userId: userId },
                }),
                tx.summaries.updateMany({
                  where: { userId: existingEpilogueUser.id },
                  data: { userId: userId },
                }),
                tx.user.delete({
                  where: { id: existingEpilogueUser.id },
                }),
                tx.user.update({
                  where: { id: userId },
                  data: {
                    epilogueId: epilogueUser.id,
                    epilogueUsername: epilogueUser.username,
                    epilogueToken: accessToken,
                  },
                }),
              ]);

              redirectUrl = "/settings?success=accounts_merged";
            } else if (currentUser?.epilogueId === epilogueUser.id) {
              await tx.user.update({
                where: { id: userId },
                data: {
                  epilogueToken: accessToken,
                },
              });
              redirectUrl = "/settings?success=epilogue_updated";
            } else {
              await tx.user.update({
                where: { id: userId },
                data: {
                  epilogueId: epilogueUser.id,
                  epilogueUsername: epilogueUser.username,
                  epilogueToken: accessToken,
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
        where: { epilogueId: epilogueUser.id },
      });

      if (!user) {
        const userEmail =
          epilogueUser.email || `epilogue_${epilogueUser.id}@temp.ziit.app`;
        const username =
          epilogueUser.username || `epilogue_user_${epilogueUser.id}`;

        user = await tx.user.create({
          data: {
            email: userEmail,
            passwordHash: null,
            epilogueId: epilogueUser.id,
            epilogueUsername: username,
            epilogueToken: accessToken,
          },
        });
      } else {
        const username =
          epilogueUser.username ||
          user.epilogueUsername ||
          `epilogue_user_${epilogueUser.id}`;

        user = await tx.user.update({
          where: { id: user.id },
          data: {
            epilogueToken: accessToken,
            epilogueUsername: username,
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
        : "An unknown error occurred during Epilogue authentication.";
    throw handleApiError(
      69,
      `Epilogue authentication failed: ${detailedMessage}`,
      "Epilogue authentication failed. Please try again."
    );
  }
});
