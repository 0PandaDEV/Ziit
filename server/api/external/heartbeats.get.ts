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

    const heartbeats = await prisma.heartbeat.findMany({
      where: {
        userId: user.id,
      },
      orderBy: {
        timestamp: "desc",
      },
      take: 50,
    });

    return heartbeats;
  } catch (error: any) {
    if (error.statusCode) {
      throw error;
    }
    console.error("Error fetching recent heartbeats:", error);
    throw createError({
      statusCode: 500,
      statusMessage: "Internal server error",
    });
  }
});
