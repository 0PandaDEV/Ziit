import { PrismaClient } from "@prisma/client";
import { H3Event } from "h3";

const prisma = new PrismaClient();

export default defineEventHandler(async (event: H3Event) => {
  try {
    const authHeader = getHeader(event, "authorization");
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      throw createError({
        statusCode: 401,
        statusMessage: "Unauthorized: Missing or invalid API key",
      });
    }

    const apiKey = authHeader.substring(7);

    const user = await prisma.user.findUnique({
      where: { apiKey },
    });

    if (!user) {
      throw createError({
        statusCode: 401,
        statusMessage: "Unauthorized: Invalid API key",
      });
    }

    const body = await readBody(event);

    if (!body || !body.timestamp) {
      throw createError({
        statusCode: 400,
        statusMessage: "Bad request: Missing required fields",
      });
    }

    const heartbeat = await prisma.heartbeat.create({
      data: {
        userId: user.id,
        timestamp: new Date(body.timestamp),
        project: body.project,
        language: body.language,
        file: body.file,
      },
    });

    return {
      success: true,
      id: heartbeat.id,
    };
  } catch (error: any) {
    if (error.statusCode) {
      throw error;
    }
    console.error("Error processing heartbeat:", error);
    throw createError({
      statusCode: 500,
      statusMessage: "Internal server error",
    });
  }
});
