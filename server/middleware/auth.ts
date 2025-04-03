import { prisma } from "~~/prisma/prisma";
import jwt from "jsonwebtoken";

export default defineEventHandler(async (event) => {
  console.log("Middleware path:", event.path);

  if (
    event.path === "/" ||
    event.path.startsWith("/_nuxt") ||
    (event.path.startsWith("/api/auth/") &&
      !event.path.startsWith("/api/auth/user"))
  ) {
    return;
  }

  const protectedRoutes = ["/profile", "/dashboard"];
  const authRoutes = ["/login", "/register"];

  const sessionCookie = getCookie(event, "session");
  let authenticated = false;
  let userId = null;

  if (sessionCookie) {
    try {
      const config = useRuntimeConfig();
      const decoded = jwt.verify(sessionCookie, config.jwtSecret);

      if (
        typeof decoded === "object" &&
        decoded !== null &&
        "userId" in decoded
      ) {
        userId = decoded.userId;
        const user = await prisma.user.findUnique({
          where: { id: userId },
          select: {
            id: true,
            email: true,
            githubId: true,
            githubUsername: true,
          },
        });

        if (user) {
          const hasGithub = !!user.githubId;
          const userName = hasGithub
            ? user.githubUsername
            : user.email.split("@")[0];

          event.context.user = {
            ...user,
            name: userName,
            hasGithubAccount: hasGithub,
          };
          authenticated = true;
        }
      }
    } catch (error) {
      deleteCookie(event, "session");
    }
  }

  if (!event.path.startsWith("/api/")) {
    if (authenticated) {
      if (authRoutes.includes(event.path)) {
        console.log(
          "Redirecting authenticated user from",
          event.path,
          "to /dashboard"
        );
        return sendRedirect(event, "/dashboard");
      }
    }

    if (!authenticated) {
      if (protectedRoutes.includes(event.path)) {
        console.log(
          "Redirecting unauthenticated user from",
          event.path,
          "to /login"
        );
        return sendRedirect(event, "/login");
      }
    }
  }

  event.context.auth = {
    authenticated,
    userId,
  };
});
