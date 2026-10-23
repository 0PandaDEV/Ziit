import { H3Event } from "h3";
import { z } from "zod";
import { prisma } from "~~/prisma/db";
import { handleApiError } from "~~/server/utils/logging";

defineRouteMeta({
  openAPI: {
    tags: ["External", "User"],
    summary: "Get user via API key",
    description:
      "Returns public user data for the account identified by the Bearer API key.",
    security: [{ bearerAuth: [] }],
    responses: {
      200: { description: "User object" },
      401: { description: "Invalid or missing API key" },
      404: { description: "User not found" },
      500: { description: "Server error" },
    },
    operationId: "getExternalUser",
  },
});

const apiKeySchema = z.uuid();

export default defineEventHandler(async (event: H3Event) => {
  try {
    const authHeader = getHeader(event, "authorization");
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      throw handleApiError(
        401,
        "External User API: Missing or invalid API key format in header.",
        "API key is missing or improperly formatted."
      );
    }

    const apiKey = authHeader.substring(7);
    const validationResult = apiKeySchema.safeParse(apiKey);

    if (!validationResult.success) {
      throw handleApiError(
        401,
        `External User API: Invalid API key format.`,
        "Invalid API key format."
      );
    }

    const userResult = await prisma.$queryRaw<
      Array<{
        id: string;
        email: string;
        githubId: string | null;
        githubUsername: string | null;
        apiKey: string;
      }>
    >`
      SELECT id, email, "githubId", "githubUsername", "apiKey"
      FROM "User"
      WHERE "apiKey" = ${apiKey}
      LIMIT 1
    `;

    const user = userResult[0] || null;

    if (!user) {
      throw handleApiError(
        404,
        `External User API: User not found for provided API key.`,
        "User not found."
      );
    }

    return user;
  } catch (error: any) {
    if (error && typeof error === "object" && error.statusCode) throw error;
    const detailedMessage =
      error instanceof Error
        ? error.message
        : "An unknown error occurred fetching external user data.";
    throw handleApiError(
      69,
      `External User API: Failed to fetch user data. Error: ${detailedMessage}`,
      "Failed to fetch user data."
    );
  }
});
