import { v4 as uuidv4 } from "uuid";

export default defineEventHandler(async (event) => {
  const config = useRuntimeConfig();

  const sessionCookie = getCookie(event, "session");
  if (!sessionCookie) {
    console.log("GitHub link attempt with no session cookie");
    return sendRedirect(event, "/login?error=unauthorized");
  }

  const state = uuidv4();
  console.log("Starting GitHub link process with state:", state);

  setCookie(event, "github_oauth_state", state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    maxAge: 60 * 10,
    path: "/",
  });

  setCookie(event, "github_link_account", "true", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    maxAge: 60 * 10,
    path: "/",
  });

  setCookie(event, "github_link_session", sessionCookie, {
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

  console.log("Redirecting to GitHub auth URL for account linking");

  return sendRedirect(event, githubAuthUrl.toString());
});
