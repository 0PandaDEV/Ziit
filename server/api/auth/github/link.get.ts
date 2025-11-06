import { H3Event } from "h3";
import { decrypt, encrypt } from "paseto-ts/v4";
import { handleApiError } from "~~/server/utils/logging";

defineRouteMeta({
  openAPI: {
    tags: ["Auth", "GitHub"],
    summary: "Begin GitHub account linking",
    description:
      "Starts OAuth flow to link a GitHub account to the authenticated user. Returns an authorization URL.",
    responses: {
      200: {
        description: "Authorization URL generated",
        content: {
          "application/json": {
            schema: {
              type: "object",
              properties: { url: { type: "string", format: "uri" } },
            },
          },
        },
      },
      401: { description: "Unauthorized or invalid session" },
      500: { description: "Failed to generate GitHub auth URL" },
    },
    operationId: "getGithubLink",
  },
});

export default defineEventHandler(async (event: H3Event) => {
  const config = useRuntimeConfig();

  if (config.disableRegistering === "true") {
    throw createError({
      statusCode: 403,
      message: "Registration is currently disabled",
    });
  }

  const sessionCookie = getCookie(event, "ziit_session");

  if (!sessionCookie) {
    throw createError({
      statusCode: 401,
      message: "No session found",
    });
  }

  let userId: string;
  try {
    const { payload } = decrypt(config.pasetoKey, sessionCookie);

    if (
      typeof payload !== "object" ||
      payload === null ||
      !("userId" in payload)
    ) {
      throw createError({
        statusCode: 401,
        message: "Invalid token",
      });
    }
    userId = payload.userId;
  } catch {
    throw createError({
      statusCode: 401,
      message: "Invalid token",
    });
  }

  const state = crypto.randomUUID();

  setCookie(event, "github_oauth_state", state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    maxAge: 60 * 10,
    path: "/",
    sameSite: "lax",
  });

  setCookie(event, "github_link_account", "true", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    maxAge: 60 * 10,
    path: "/",
    sameSite: "lax",
  });

  const token = encrypt(config.pasetoKey, {
    userId,
    exp: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
  });

  setCookie(event, "github_link_session", token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    maxAge: 60 * 10,
    path: "/",
    sameSite: "lax",
  });

  const githubAuthUrl = new URL("https://github.com/login/oauth/authorize");
  githubAuthUrl.searchParams.append("client_id", config.githubClientId);
  githubAuthUrl.searchParams.append(
    "redirect_uri",
    `${config.baseUrl}/api/auth/github/callback`
  );
  githubAuthUrl.searchParams.append("state", state);
  githubAuthUrl.searchParams.append("scope", "read:user user:email");

  try {
    return { url: githubAuthUrl.toString() };
  } catch (error) {
    const detailedMessage =
      error instanceof Error
        ? error.message
        : "An unknown error occurred while generating GitHub auth URL.";
    throw handleApiError(
      69,
      `Failed to generate GitHub auth URL: ${detailedMessage}`,
      "Could not initiate GitHub linking. Please try again."
    );
  }
});
