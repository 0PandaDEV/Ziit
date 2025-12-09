import { decrypt } from "paseto-ts/v4";

import type { H3Event } from "h3";
import { prisma } from "~~/prisma/db";

const AUTH_CONFIG = {
  publicApiPaths: [
    "/api/external/",
    "/api/auth/",
    "/api/public/",
    "/api/leaderboard/",
  ],
  publicPages: [
    "/stats",
    "/leaderboard",
    "/login",
    "/register",
    "/sitemap.xml",
    "/robots.txt",
    "/_openapi.json",
  ],
  sessionCookieName: "ziit_session",
  loginRedirectPath: "/login",
};

export default defineEventHandler(async (event: H3Event) => {
  const path = getRequestURL(event).pathname;
  const sessionCookie = getCookie(event, AUTH_CONFIG.sessionCookieName);

  if (isPublicPath(path)) {
    return;
  }

  if (!sessionCookie) {
    if (path.startsWith("/api/")) {
      throw createError({
        statusCode: 401,
        message: "Unauthorized",
      });
    }
    return sendRedirect(event, AUTH_CONFIG.loginRedirectPath);
  }

  try {
    const config = useRuntimeConfig();
    const { payload } = decrypt(config.pasetoKey, sessionCookie);

    if (!payload || typeof payload !== "object" || !("userId" in payload)) {
      throw new Error("Invalid token");
    }

    const user = await prisma.user.findUnique({
      where: { id: payload.userId },
    });

    if (!user) {
      throw new Error("User not found");
    }

    event.context.user = user;
    return;
  } catch (error) {
    console.error("Auth middleware error:", error);
    deleteCookie(event, AUTH_CONFIG.sessionCookieName);

    if (path.startsWith("/api/")) {
      throw createError({
        statusCode: 401,
        message: "Unauthorized",
      });
    }
    return sendRedirect(event, AUTH_CONFIG.loginRedirectPath);
  }
});

function isPublicPath(path: string): boolean {
  for (const publicPath of AUTH_CONFIG.publicApiPaths) {
    if (path.startsWith(publicPath)) {
      return true;
    }
  }
  return AUTH_CONFIG.publicPages.includes(path);
}
