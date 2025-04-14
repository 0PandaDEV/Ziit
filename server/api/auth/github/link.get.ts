import { H3Event } from "h3";
import jwt from "jsonwebtoken";

export default defineEventHandler(async (event: H3Event) => {
  const config = useRuntimeConfig();

  if (config.disableRegistering === "true") {
    throw createError({
      statusCode: 403,
      message: "Registration is currently disabled"
    });
  }

  if (!event.context.user) {
    throw createError({
      statusCode: 401,
      message: "Unauthorized",
    });
  }

  const sessionCookie = getCookie(event, "session");
  
  if (!sessionCookie) {
    throw createError({
      statusCode: 401,
      message: "No session found",
    });
  }
  
  let userId: string;
  try {
    const decoded = jwt.verify(sessionCookie, config.jwtSecret);
    if (typeof decoded !== "object" || decoded === null || !("userId" in decoded)) {
      throw createError({
        statusCode: 401,
        message: "Invalid token",
      });
    }
    userId = decoded.userId;
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
    sameSite: "lax"
  });

  setCookie(event, "github_link_account", "true", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    maxAge: 60 * 10,
    path: "/",
    sameSite: "lax"
  });

  const token = jwt.sign({ userId }, config.jwtSecret, {
    expiresIn: "7d",
  });

  setCookie(event, "github_link_session", token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    maxAge: 60 * 10,
    path: "/",
    sameSite: "lax"
  });

  const githubAuthUrl = new URL("https://github.com/login/oauth/authorize");
  githubAuthUrl.searchParams.append("client_id", config.githubClientId);
  githubAuthUrl.searchParams.append("redirect_uri", config.githubRedirectUri);
  githubAuthUrl.searchParams.append("state", state);
  githubAuthUrl.searchParams.append("scope", "read:user user:email");

  return sendRedirect(event, githubAuthUrl.toString());
});
