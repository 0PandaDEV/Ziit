import { prisma } from "~~/prisma/prisma";
import jwt from "jsonwebtoken";

export default defineEventHandler(async (event) => {
  if (event.context.user) {
    return event.context.user;
  }

  const sessionCookie = getCookie(event, "session");

  if (!sessionCookie) {
    throw createError({
      statusCode: 401,
      message: "Unauthorized",
    });
  }

  try {
    const config = useRuntimeConfig();
    const decoded = jwt.verify(sessionCookie, config.jwtSecret);

    if (
      typeof decoded !== "object" ||
      decoded === null ||
      !("userId" in decoded)
    ) {
      throw new Error("Invalid token format");
    }

    const user = await prisma.user.findUnique({
      where: { id: decoded.userId },
      select: {
        id: true,
        email: true,
        githubId: true,
        githubUsername: true,
        apiKey: true,
      },
    });

    if (!user) {
      throw createError({
        statusCode: 404,
        message: "User not found",
      });
    }

    const hasGithub = !!user.githubId;
    const userName = hasGithub ? user.githubUsername : user.email.split("@")[0];

    const enrichedUser = {
      ...user,
      name: userName,
      hasGithubAccount: hasGithub,
    };

    event.context.user = enrichedUser;
    return enrichedUser;
  } catch (error) {
    deleteCookie(event, "session");
    throw createError({
      statusCode: 401,
      message: "Invalid session" + error,
    });
  }
});
