import { H3Event } from "h3";
import { decrypt, encrypt } from "paseto-ts/v4";
import { handleApiError } from "~~/server/utils/logging";

defineRouteMeta({
  openAPI: {
    tags: ["Auth", "Epilogue"],
    summary: "Begin Epilogue account linking",
    description:
      "Starts OAuth flow to link an Epilogue account to the authenticated user. Returns an authorization URL.",
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
      500: { description: "Failed to generate Epilogue auth URL" },
    },
    operationId: "getEpilogueLink",
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

  if (!event.context.user) {
    console.error("Epilogue Link error: Unauthorized access attempt");
    throw createError({
      statusCode: 401,
      message: "Unauthorized",
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

  if (!config.epilogueAppId || !config.baseUrl) {
    throw createError({
      statusCode: 500,
      message: "Epilogue auth is not configured",
    });
  }

  const state = crypto.randomUUID();

  setCookie(event, "epilogue_oauth_state", state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    maxAge: 60 * 10,
    path: "/",
    sameSite: "lax",
  });

  setCookie(event, "epilogue_link_account", "true", {
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

  setCookie(event, "epilogue_link_session", token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    maxAge: 60 * 10,
    path: "/",
    sameSite: "lax",
  });

  const epilogueAuthUrl = new URL("https://auth.epilogue.team/authorize/");
  epilogueAuthUrl.searchParams.append("app_id", config.epilogueAppId);
  epilogueAuthUrl.searchParams.append(
    "redirect_url",
    `${config.baseUrl}/api/auth/epilogue/callback`
  );
  const host = getHeader(event, "host");
  const protocol = getHeader(event, "x-forwarded-proto") || "http";
  const frontendUrl = `${protocol}://${host}`;
  epilogueAuthUrl.searchParams.append("cancel_url", `${frontendUrl}/settings?error=link_cancelled`);
  epilogueAuthUrl.searchParams.append("state", state);

  try {
    return { url: epilogueAuthUrl.toString() };
  } catch (error) {
    const detailedMessage = error instanceof Error ? error.message : "An unknown error occurred while generating Epilogue auth URL.";
    throw handleApiError(69, `Failed to generate Epilogue auth URL: ${detailedMessage}`, "Could not initiate Epilogue linking. Please try again.");
  }
});