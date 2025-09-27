import { handleApiError } from "~~/server/utils/logging";

defineRouteMeta({
  openAPI: {
    tags: ["Auth", "Epilogue"],
    summary: "Start Epilogue OAuth",
    description:
      "Initializes Epilogue OAuth and redirects the client to Epilogue authorization page.",
    responses: {
      302: { description: "Redirect to Epilogue OAuth" },
      403: { description: "Registration disabled" },
      500: { description: "Failed to initialize Epilogue auth" },
    },
    operationId: "getEpilogueAuthStart",
  },
});

export default defineEventHandler(async (event) => {
  try {
    const config = useRuntimeConfig();

    if (config.disableRegistering === "true") {
      throw createError({
        statusCode: 403,
        message: "Registration is currently disabled",
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
    });

    const host = getHeader(event, "host");
    const protocol = getHeader(event, "x-forwarded-proto") || "http";
    const frontendUrl = `${protocol}://${host}`;

    const epilogueAuthUrl = new URL("https://auth.epilogue.team/authorize/");
    epilogueAuthUrl.searchParams.append("app_id", config.epilogueAppId);
    epilogueAuthUrl.searchParams.append(
      "redirect_url",
      `${config.baseUrl}/api/auth/epilogue/callback`
    );
    epilogueAuthUrl.searchParams.append(
      "cancel_url",
      `${frontendUrl}/login?error=cancelled`
    );
    epilogueAuthUrl.searchParams.append("state", state);

    return sendRedirect(event, epilogueAuthUrl.toString());
  } catch (error: any) {
    if (error && typeof error === "object" && error.statusCode) throw error;
    const detailedMessage =
      error instanceof Error
        ? error.message
        : "An unknown error occurred during Epilogue auth initialization.";
    throw handleApiError(
      69,
      `Failed to initialize Epilogue authentication: ${detailedMessage}`,
      "Could not initiate Epilogue authentication. Please try again."
    );
  }
});
