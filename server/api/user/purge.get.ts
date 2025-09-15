import { PrismaClient } from "@prisma/client";
import { H3Event } from "h3";
import { handleApiError } from "~~/server/utils/logging";

defineRouteMeta({
  openAPI: {
    tags: ["User"],
    summary: "Delete current user",
    description: "Deletes the authenticated user from the database.",
    responses: {
      200: { description: "Deleted user object" },
      404: { description: "User not found" },
      500: { description: "Failed to delete user" },
    },
    operationId: "deleteUser",
  },
});

const prisma = new PrismaClient();

export default defineEventHandler(async (event: H3Event) => {
  try {
    await prisma.summaries.deleteMany({
      where: { userId: event.context.user.id },
    });

    await prisma.heartbeats.deleteMany({
      where: { userId: event.context.user.id },
    });

    return {
      success: true,
      message: "User data successfully purged",
      userId: event.context.user.id,
    };
  } catch (error: any) {
    const detailedMessage =
      error instanceof Error
        ? error.message
        : "An unknown error occurred while purging user data.";
    throw handleApiError(
      69,
      `Failed to purge user data ${event.context.user.id}: ${detailedMessage}`,
      "Failed to purge user data. Please try again."
    );
  }
});
