import { PrismaClient } from "@prisma/client";
import { H3Event } from "h3";
import { z } from "zod";
import { handleApiError } from "~~/server/utils/logging";

const prisma = new PrismaClient({
  log: ['warn', 'error'],
});

const apiKeySchema = z.string().uuid();

const heartbeatSchema = z.object({
  timestamp: z.string().datetime().or(z.number()),
  project: z.string().min(1).max(255),
  language: z.string().min(1).max(50),
  editor: z.string().min(1).max(50),
  os: z.string().min(1).max(50),
  branch: z.string().max(255).optional(),
  file: z.string().max(255),
});

export default defineEventHandler(async (event: H3Event) => {
  try {
    const authHeader = getHeader(event, "authorization");
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      throw handleApiError(401, "Heartbeat API error: Missing or invalid API key format in header.");
    }

    const apiKey = authHeader.substring(7);
    const validationResult = apiKeySchema.safeParse(apiKey);

    if (!validationResult.success) {
      throw handleApiError(401, `Heartbeat API error: Invalid API key format. Key: ${apiKey.substring(0,4)}...`);
    }

    const user = await prisma.user.findUnique({
      where: { apiKey },
      select: { id: true, apiKey: true },
    });

    if (!user || user.apiKey !== apiKey) {
      throw handleApiError(401, `Heartbeat API error: Invalid API key. Key: ${apiKey.substring(0,4)}...`);
    }

    const body = await readBody(event);
    const validatedData = heartbeatSchema.parse(body);

    const timestamp =
      typeof validatedData.timestamp === "number"
        ? BigInt(validatedData.timestamp)
        : BigInt(new Date(validatedData.timestamp).getTime());

    const heartbeat = await prisma.heartbeats.create({
      data: {
        userId: user.id,
        timestamp,
        project: validatedData.project,
        language: validatedData.language,
        editor: validatedData.editor,
        os: validatedData.os,
        branch: validatedData.branch,
        file: validatedData.file,
      },
    });

    return {
      success: true,
      id: heartbeat.id,
    };
  } catch (error: any) {
    if (error && typeof error === "object" && error.statusCode) throw error;
    if (error instanceof z.ZodError) {
      throw handleApiError(400, `Heartbeat API error: Validation error. Details: ${error.errors[0].message}`);
    }
    const detailedMessage = error instanceof Error ? error.message : "An unknown error occurred processing heartbeat.";
    const apiKeyPrefix = getHeader(event, "authorization")?.substring(7,11) || "UNKNOWN";
    throw handleApiError(500, `Heartbeat API error: Failed to process heartbeat. API Key prefix: ${apiKeyPrefix}... Error: ${detailedMessage}`, "Failed to process your request.");
  }
});
