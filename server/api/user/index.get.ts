import { PrismaClient } from "@prisma/client";
import { H3Event } from "h3";
import { handleApiError} from "~~/server/utils/logging";

defineRouteMeta({
  openAPI: {
    tags: ["User"],
    summary: "Get current user profile",
    description: "Returns basic profile fields for the authenticated user.",
    responses: {
      200: { description: "User object" },
      404: { description: "User not found" },
      500: { description: "Failed to fetch user data" },
    },
    operationId: "getUserProfile",
  },
});

const prisma = new PrismaClient();

export default defineEventHandler(async (event: H3Event) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: event.context.user.id },
      select: {
        id: true,
        email: true,
        githubId: true,
        githubUsername: true,
        epilogueId: true,
        epilogueUsername: true,
        apiKey: true,
        keystrokeTimeout: true,
        leaderboardEnabled: true
      },
    });

    if (!user) {
      throw handleApiError(404, `User not found for ID ${event.context.user.id}`, "User not found.");
    }

    return user;
  } catch (error: any) {
    const detailedMessage = error instanceof Error ? error.message : "An unknown error occurred while fetching user data.";
    throw handleApiError(500, `Failed to fetch user data for user ${event.context.user.id}: ${detailedMessage}`, "Failed to fetch user data. Please try again.");
  }
});
