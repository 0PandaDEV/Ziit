import { PrismaClient } from "@prisma/client";
import { H3Event } from "h3";

const prisma = new PrismaClient();

export default defineEventHandler(async (event: H3Event) => {
  if (!event.context.user) {
    console.error("User error: Unauthorized access attempt");
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
        keystrokeTimeout: true,
      },
    });

    if (!user) {
      console.error(`User error: User not found for ID ${event.context.user.id}`);
      throw createError({
        statusCode: 404,
        message: "User not found",
      });
    }

    return user;
  } catch (error: any) {
    console.error("User error:", error instanceof Error ? error.message : "Unknown error");
    throw createError({
      statusCode: 500,
      message: "Failed to fetch user data",
    });
  }
});
