import { decrypt } from "paseto-ts/v4";
import { PrismaClient } from "@prisma/client";
import type { H3Event } from "h3";

const prisma = new PrismaClient();

const AUTH_CONFIG = {
  publicApiPaths: ["/api/external/", "/api/auth/", "/api/public"],
  publicPages: ["/stats", "/login", "/register", "/sitemap.xml", "/robots.txt"],
  sessionCookieName: "ziit_session",
  loginRedirectPath: "/login",
};

export default defineEventHandler(async (event: H3Event) => {
  const path = getRequestURL(event).pathname;
  const sessionCookie = getCookie(event, AUTH_CONFIG.sessionCookieName);

  if (isPublicPath(path)) {
    return;
  }

  if (path.startsWith("/api/")) {
    if (!sessionCookie) {
      throw createError({
        statusCode: 401,
        message: "Unauthorized",
      });
    }
  }

  if (!sessionCookie) {
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
    console.error(error);
    deleteCookie(event, AUTH_CONFIG.sessionCookieName);
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
