import { PrismaClient } from "@prisma/client";
import { H3Event } from "h3";
import { z } from "zod";
import { handleApiError } from "~/server/utils/error";

const prisma = new PrismaClient();

const apiKeySchema = z.string().uuid();

export default defineEventHandler(async (event: H3Event) => {
  try {
    const authHeader = getHeader(event, "authorization");
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      throw handleApiError(401, "External User API: Missing or invalid API key format in header.");
    }

    const apiKey = authHeader.substring(7);
    const validationResult = apiKeySchema.safeParse(apiKey);

    if (!validationResult.success) {
      throw handleApiError(401, `External User API: Invalid API key format. Key prefix: ${apiKey.substring(0,4)}...`);
    }

    const user = await prisma.user.findUnique({
      where: { apiKey },
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
      throw handleApiError(404, `External User API: User not found for API key prefix: ${apiKey.substring(0,4)}...`);
    }

    return user;
  } catch (error: any) {
    const apiKeyPrefix = getHeader(event, "authorization")?.substring(7,11);
    return handleApiError(error, `External User API: Failed to fetch user data. API Key prefix: ${apiKeyPrefix}...`);
  }
});
