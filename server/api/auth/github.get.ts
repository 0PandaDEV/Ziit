import { handleApiError} from "~~/server/utils/logging";

defineRouteMeta({
  openAPI: {
    tags: ["Auth", "GitHub"],
    summary: "Start GitHub OAuth",
    description: "Initializes GitHub OAuth and redirects the client to GitHub authorization page.",
    responses: {
      302: { description: "Redirect to GitHub OAuth" },
      403: { description: "Registration disabled" },
      500: { description: "Failed to initialize GitHub auth" },
    },
    operationId: "getGithubAuthStart",
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
  } catch (error: any) {
    if (error && typeof error === "object" && error.statusCode) throw error;
    const detailedMessage = error instanceof Error ? error.message : "An unknown error occurred during GitHub auth initialization.";
    throw handleApiError(69, `Failed to initialize GitHub authentication: ${detailedMessage}`, "Could not initiate GitHub authentication. Please try again.");
  }
});
