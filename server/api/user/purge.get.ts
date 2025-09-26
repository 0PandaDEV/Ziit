import { PrismaClient } from "@prisma/client";
import { H3Event } from "h3";
import { handleApiError } from "~~/server/utils/logging";

defineRouteMeta({
  openAPI: {
    tags: ["User"],
    summary: "Delete current user data",
    description:
      "Deletes all heartbeats and summaries for the authenticated user using optimized bulk operations.",
    responses: {
      200: { description: "User data purged successfully" },
      404: { description: "User not found" },
      500: { description: "Failed to delete user data" },
    },
    operationId: "purgeUserData",
  },
});

const prisma = new PrismaClient();

export default defineEventHandler(async (event: H3Event) => {
  try {
    const userId = event.context.user.id;

    await prisma.$transaction(async (tx) => {
      const summariesResult = await tx.$executeRaw`
        DELETE FROM "Summaries"
        WHERE "userId" = ${userId}
      `;

      const heartbeatsResult = await tx.$executeRaw`
        DELETE FROM "Heartbeats"
        WHERE "userId" = ${userId}
      `;

      return {
        summariesDeleted: summariesResult,
        heartbeatsDeleted: heartbeatsResult,
      };
    });

    return {
      success: true,
      message: "User data successfully purged",
      userId: userId,
    };
  } catch (error: any) {
    const detailedMessage =
      error instanceof Error
        ? error.message
        : "An unknown error occurred while purging user data.";
    throw handleApiError(
      69,
      `Failed to purge user data ${event.context.user.id}: ${detailedMessage}`,
      "Failed to purge user data. Please try again.",
    );
  }
});
