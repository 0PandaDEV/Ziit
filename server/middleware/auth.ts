import { decrypt } from "paseto-ts/v4";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

export default defineEventHandler(async (event) => {
  const path = getRequestURL(event).pathname;
  const sessionCookie = getCookie(event, "ziit_session");

  if (
    path.startsWith("/api/external/") ||
    path.startsWith("/api/auth/") ||
    path === "/login" ||
    path === "/register"
  ) {
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
    return sendRedirect(event, "/login");
  }

  try {
    const config = useRuntimeConfig();    
    const { payload } = await decrypt(config.pasetoKey, sessionCookie);
    
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
    deleteCookie(event, "ziit_session");
    return sendRedirect(event, "/login");
  }
});
