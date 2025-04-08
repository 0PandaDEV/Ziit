import { PrismaClient } from "@prisma/client";
import { H3Event } from "h3";

const prisma = new PrismaClient();

export default defineEventHandler(async (event: H3Event) => {
  if (!event.context.user) {
    throw createError({
      statusCode: 401,
      message: "Unauthorized",
    });
  }

  try {
    const user = await prisma.user.findUnique({
      where: { id: event.context.user.id },
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

    return enrichedUser;
  } catch (error: any) {
    console.error("Error fetching user:", error);
    throw createError({
      statusCode: error.statusCode || 500,
      statusMessage: error.statusMessage || "Internal server error",
    });
  }
});
