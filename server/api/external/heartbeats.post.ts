import { PrismaClient } from "@prisma/client";
import { H3Event } from "h3";
import { z } from "zod";

const prisma = new PrismaClient();

const heartbeatSchema = z.object({
  timestamp: z.string().datetime(),
  project: z.string().min(1).max(255),
  language: z.string().min(1).max(50),
  editor: z.string().min(1).max(50),
  os: z.string().min(1).max(50),
});

export default defineEventHandler(async (event: H3Event) => {
  try {
    const authHeader = getHeader(event, "authorization");
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      console.error("Heartbeats error: Missing or invalid API key format");
      throw createError({
        statusCode: 401,
        statusMessage: "Unauthorized: Missing or invalid API key",
      });
    }

    const apiKey = authHeader.substring(7);
    if (!apiKey || apiKey.length !== 32) {
      console.error("Heartbeats error: Invalid API key length");
      throw createError({
        statusCode: 401,
        statusMessage: "Unauthorized: Invalid API key format",
      });
    }

    const user = await prisma.user.findUnique({
      where: { apiKey },
      select: { id: true, apiKey: true },
    });

    if (!user || user.apiKey !== apiKey) {
      console.error("Heartbeats error: Invalid API key");
      throw createError({
        statusCode: 401,
        statusMessage: "Unauthorized: Invalid API key",
      });
    }

    const body = await readBody(event);
    const validatedData = heartbeatSchema.parse(body);

    const heartbeat = await prisma.heartbeat.create({
      data: {
        userId: user.id,
        timestamp: new Date(validatedData.timestamp),
        project: validatedData.project,
        language: validatedData.language,
        editor: validatedData.editor,
        os: validatedData.os,
      },
    });

    return {
      success: true,
      id: heartbeat.id,
    };
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      console.error("Heartbeats error: Validation error", error.errors[0].message);
      throw createError({
        statusCode: 400,
        statusMessage: `Bad request: ${error.errors[0].message}`,
      });
    }
    if (error.statusCode) {
      throw error;
    }
    console.error("Heartbeats error:", error instanceof Error ? error.message : "Unknown error");
    throw createError({
      statusCode: 500,
      statusMessage: "Internal server error",
    });
  }
});
