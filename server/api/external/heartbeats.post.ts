import { PrismaClient } from "@prisma/client";
import { H3Event } from "h3";
import { z } from "zod";
import { createStandardError, handleApiError } from "~/server/utils/error";

const prisma = new PrismaClient();

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
      console.error("Heartbeats error: Missing or invalid API key format");
      throw createStandardError(401, "Missing or invalid API key format");
    }

    const apiKey = authHeader.substring(7);
    const validationResult = apiKeySchema.safeParse(apiKey);

    if (!validationResult.success) {
      throw createStandardError(401, "Invalid API key format");
    }

    const user = await prisma.user.findUnique({
      where: { apiKey },
      select: { id: true, apiKey: true },
    });

    if (!user || user.apiKey !== apiKey) {
      console.error("Heartbeats error: Invalid API key");
      throw createStandardError(401, "Invalid API key");
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
    if (error instanceof z.ZodError) {
      console.error(
        "Heartbeats error: Validation error",
        error.errors[0].message
      );
      throw createStandardError(400, error.errors[0].message);
    }
    if (error.statusCode) {
      throw error;
    }
    return handleApiError(error, "Failed to process heartbeat");
  }
});
