import jwt from "jsonwebtoken";
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
    const decoded = jwt.verify(sessionCookie, config.jwtSecret);

    if (
      typeof decoded !== "object" ||
      decoded === null ||
      !("userId" in decoded)
    ) {
      throw new Error("Invalid token");
    }

    const user = await prisma.user.findUnique({
      where: { id: decoded.userId },
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
