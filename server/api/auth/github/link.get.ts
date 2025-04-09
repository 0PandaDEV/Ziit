import { H3Event } from "h3";
import jwt from "jsonwebtoken";

export default defineEventHandler(async (event: H3Event) => {
  if (!event.context.user) {
    console.error("GitHub Link error: Unauthorized access attempt");
    throw createError({
      statusCode: 401,
      message: "Unauthorized",
    });
  }

  const config = useRuntimeConfig();
  const state = crypto.randomUUID();

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

  const token = jwt.sign({ userId: event.context.user.id }, config.jwtSecret, {
    expiresIn: "7d",
  });

  setCookie(event, "github_link_session", token, {
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
});
