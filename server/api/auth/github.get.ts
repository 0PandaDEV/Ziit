import { handleApiError } from "~/server/utils/error";

export default defineEventHandler(async (event) => {
  try {
    const config = useRuntimeConfig();

  if (config.disableRegistering === "true") {
    throw createError({
      statusCode: 403,
      message: "Registration is currently disabled",
    });
  }

    const state = crypto.randomUUID();

    setCookie(event, "github_oauth_state", state, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      maxAge: 60 * 10,
      path: "/",
    });

    const githubAuthUrl = new URL("https://github.com/login/oauth/authorize");
    githubAuthUrl.searchParams.append("client_id", config.githubClientId);
    githubAuthUrl.searchParams.append("redirect_uri", config.githubRedirectUri);
    githubAuthUrl.searchParams.append("state", state);
    githubAuthUrl.searchParams.append("scope", "read:user user:email");

    return sendRedirect(event, githubAuthUrl.toString());
  } catch (error) {
    const detailedMessage = error instanceof Error ? error.message : "An unknown error occurred during GitHub auth initialization.";
    return handleApiError(500, `Failed to initialize GitHub authentication: ${detailedMessage}`, "Could not initiate GitHub authentication. Please try again.");
  }
});
