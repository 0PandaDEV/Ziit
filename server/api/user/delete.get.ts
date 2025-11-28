import { H3Event } from "h3";
import { prisma } from "~~/prisma/prisma";
import { handleApiError } from "~~/server/utils/logging";

defineRouteMeta({
  openAPI: {
    tags: ["User"],
    summary: "Delete current user",
    description: "Deletes the authenticated user from the database.",
    responses: {
      200: { description: "Deleted user object" },
      400: { description: "User has associated data that prevents deletion" },
      404: { description: "User not found" },
      500: { description: "Failed to delete user" },
    },
    operationId: "deleteUser",
  },
});

export default defineEventHandler(async (event: H3Event) => {
  try {
    const user = await prisma.user.delete({
      where: { id: event.context.user.id },
      select: {
        id: true,
        createdAt: true,
      },
    });
    return user;
  } catch (error: any) {
    if (error.code === "P2003") {
      throw handleApiError(
        400,
        `Cannot delete user ${event.context.user.id}: User still has associated data`,
        "Cannot delete user. Please remove all associated data first before deleting your account."
      );
    }

    if (error.code === "P2025") {
      throw handleApiError(
        404,
        `User ${event.context.user.id} not found`,
        "User not found."
      );
    }

    if (error.code && error.code.startsWith("P")) {
      throw handleApiError(
        400,
        `Prisma error ${error.code}: ${error.message}`,
        "Database operation failed. Please try again."
      );
    }

    const detailedMessage =
      error instanceof Error
        ? error.message
        : "An unknown error occurred while deleting user.";

    throw handleApiError(
      69,
      `Failed to delete user ${event.context.user.id}: ${detailedMessage}`,
      "Failed to delete user. Please try again."
    );
  }
});
