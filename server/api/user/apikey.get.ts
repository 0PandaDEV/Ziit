import { H3Event } from "h3";
import { prisma } from "~~/prisma/prisma";
import { handleApiError } from "~~/server/utils/logging";

defineRouteMeta({
  openAPI: {
    tags: ["User"],
    summary: "Regenerate API key",
    description: "Generates a new API key for the authenticated user.",
    responses: {
      200: {
        description: "New API key",
        content: {
          "application/json": {
            schema: {
              type: "object",
              properties: { apiKey: { type: "string", format: "uuid" } },
            },
          },
        },
      },
      500: { description: "Failed to generate API key" },
    },
    operationId: "getUserRegenerateApiKey",
  },
});

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
    const detailedMessage =
      error instanceof Error
        ? error.message
        : "An unknown error occurred while generating API key.";
    throw handleApiError(
      69,
      `Failed to generate API key for user ${event.context.user.id}: ${detailedMessage}`,
      "Failed to generate API key. Please try again."
    );
  }
});
