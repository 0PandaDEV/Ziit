import { PrismaClient } from "@prisma/client";
import { H3Event } from "h3";
import { z } from "zod";
import { handleApiError } from "~~/server/utils/logging";

const prisma = new PrismaClient({
  log: ["warn", "error"],
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

const batchSchema = z.array(heartbeatSchema).min(1).max(2000);

export default defineEventHandler(async (event: H3Event) => {
  try {
    const authHeader = getHeader(event, "authorization");
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      throw handleApiError(
        401,
        "Batch API error: Missing or invalid API key format in header."
      );
    }

    const apiKey = authHeader.substring(7);
    const validationResult = apiKeySchema.safeParse(apiKey);

    if (!validationResult.success) {
      throw handleApiError(
        401,
        `Batch API error: Invalid API key format. Key: ${apiKey.substring(0, 4)}...`
      );
    }

    const user = await prisma.user.findUnique({
      where: { apiKey },
      select: { id: true, apiKey: true },
    });

    if (!user || user.apiKey !== apiKey) {
      throw handleApiError(
        401,
        `Batch API error: Invalid API key. Key: ${apiKey.substring(0, 4)}...`
      );
    }

    const body = await readBody(event);
    const heartbeats = batchSchema.parse(body);

    const heartbeatsData = heartbeats.map((heartbeat) => {
      const timestamp =
        typeof heartbeat.timestamp === "number"
          ? BigInt(heartbeat.timestamp)
          : BigInt(new Date(heartbeat.timestamp).getTime());

      return {
        userId: user.id,
        timestamp,
        project: heartbeat.project,
        language: heartbeat.language,
        editor: heartbeat.editor,
        os: heartbeat.os,
        branch: heartbeat.branch,
        file: heartbeat.file,
      };
    });

    const result = await prisma.heartbeats.createMany({
      data: heartbeatsData,
      skipDuplicates: true,
    });

    return {
      success: true,
      count: result.count,
    };
  } catch (error: any) {
    if (error && typeof error === "object" && error.statusCode) throw error;
    if (error instanceof z.ZodError) {
      throw handleApiError(
        400,
        `Batch API error: Validation error. Details: ${error.message}`
      );
    }
    const detailedMessage =
      error instanceof Error
        ? error.message
        : "An unknown error occurred processing batch heartbeats.";
    const apiKeyPrefix =
      getHeader(event, "authorization")?.substring(7, 11) || "UNKNOWN";
    throw handleApiError(
      500,
      `Batch API error: Failed to process heartbeats. API Key prefix: ${apiKeyPrefix}... Error: ${detailedMessage}`,
      "Failed to process your request."
    );
  }
});
