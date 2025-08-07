import { PrismaClient } from "@prisma/client";
import { H3Event } from "h3";
import { handleApiError} from "~~/server/utils/logging";

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
        apiKey: true,
        keystrokeTimeout: true
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
