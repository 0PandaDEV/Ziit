import jwt from "jsonwebtoken";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

export default defineEventHandler(async (event) => {
  const path = getRequestURL(event).pathname;
  const sessionCookie = getCookie(event, "session");

  if (path === "/login" || path === "/register") {
    if (sessionCookie) {
      return sendRedirect(event, "/");
    }
    return;
  }

  if (path.startsWith("/api/external/")) {
    return;
  }

  if (
    path.includes("login") ||
    path.includes("register") ||
    (path.includes("github") && !path.includes("link"))
  ) {
    return;
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
    deleteCookie(event, "session");
    return sendRedirect(event, "/login");
  }
});
