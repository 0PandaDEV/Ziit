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

const batchSchema = z.array(heartbeatSchema).min(1).max(100);

export default defineEventHandler(async (event: H3Event) => {
  try {
    const authHeader = getHeader(event, "authorization");
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      throw createStandardError(401, "Missing or invalid API key");
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
      throw createStandardError(401, "Invalid API key");
    }

    const body = await readBody(event);
    const heartbeats = batchSchema.parse(body);

    const createdHeartbeats = await prisma.$transaction(
      heartbeats.map((heartbeat) => {
        const timestamp = typeof heartbeat.timestamp === 'number' 
          ? BigInt(heartbeat.timestamp) 
          : BigInt(new Date(heartbeat.timestamp).getTime());
          
        return prisma.heartbeats.create({
          data: {
            userId: user.id,
            timestamp,
            project: heartbeat.project,
            language: heartbeat.language,
            editor: heartbeat.editor,
            os: heartbeat.os,
            branch: heartbeat.branch,
            file: heartbeat.file,
          },
        });
      }),
    );

    return {
      success: true,
      count: createdHeartbeats.length,
      ids: createdHeartbeats.map((h) => h.id),
    };
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      throw createStandardError(400, error.errors[0].message);
    }
    if (error.statusCode) {
      throw error;
    }
    return handleApiError(error, "Failed to process heartbeats");
  }
});
