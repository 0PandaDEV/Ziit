import { PrismaClient } from "@prisma/client";
import { H3Event } from "h3";
import { handleApiError} from "~/server/utils/logging";

const prisma = new PrismaClient();

export default defineEventHandler(async (event: H3Event) => {
  try {
    const apiKey = crypto.randomUUID();

    const updatedUser = await prisma.user.update({
      where: {
        id: event.context.user.id,
      },
      data: {
        apiKey,
      },
      select: {
        apiKey: true,
      },
    });

    return {
      apiKey: updatedUser.apiKey,
    };
  } catch (error: any) {
    const detailedMessage = error instanceof Error ? error.message : "An unknown error occurred while generating API key.";
    throw handleApiError(500, `Failed to generate API key for user ${event.context.user.id}: ${detailedMessage}`, "Failed to generate API key. Please try again.");
  }
});
