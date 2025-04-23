import { H3Event } from "h3";
import { decrypt, encrypt } from "paseto-ts/v4";

export default defineEventHandler(async (event: H3Event) => {
  const config = useRuntimeConfig();

  if (config.disableRegistering === "true") {
    throw createError({
      statusCode: 403,
      message: "Registration is currently disabled",
    });
  }

  if (!event.context.user) {
    console.error("GitHub Link error: Unauthorized access attempt");
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
    const { payload } = await decrypt(config.pasetoKey, sessionCookie);
    
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

  const token = await encrypt(
    config.pasetoKey, 
    { 
      userId,
      exp: new Date(Date.now() + 10 * 60 * 1000).toISOString()
    }
  );

  setCookie(event, "github_link_session", token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    maxAge: 60 * 10,
    path: "/",
    sameSite: "lax",
  });

  const githubAuthUrl = new URL("https://github.com/login/oauth/authorize");
  githubAuthUrl.searchParams.append("client_id", config.githubClientId);
  githubAuthUrl.searchParams.append("redirect_uri", config.githubRedirectUri);
  githubAuthUrl.searchParams.append("state", state);
  githubAuthUrl.searchParams.append("scope", "read:user user:email");

  return sendRedirect(event, githubAuthUrl.toString());
});
