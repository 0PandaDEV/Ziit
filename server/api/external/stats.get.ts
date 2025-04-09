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

    const query = getQuery(event);
    const startDateStr = query.startDate as string;
    const endDateStr =
      (query.endDate as string) || startDateStr || new Date().toISOString().split("T")[0];

    if (!startDateStr) {
      throw createError({
        statusCode: 400,
        statusMessage: "Bad Request: startDate is required",
      });
    }

    let fetchStartDate = new Date(startDateStr + 'T00:00:00Z');
    let fetchEndDate = new Date(endDateStr + 'T23:59:59.999Z');

    const summaries = await prisma.dailyProjectSummary.findMany({
      where: {
        userId: user.id,
        date: {
          gte: fetchStartDate,
          lte: fetchEndDate,
        },
      },
      orderBy: {
        date: "asc",
      },
    });

    const heartbeats = await prisma.heartbeat.findMany({
      where: {
        userId: user.id,
        timestamp: {
          gte: fetchStartDate,
          lte: fetchEndDate,
        },
      },
      orderBy: {
        timestamp: "asc",
      },
    });

    return {
      summaries: summaries.map(s => ({
        date: s.date.toISOString().split("T")[0],
        totalSeconds: s.totalSeconds,
        project: s.project,
      })),
      heartbeats: heartbeats,
    };
  } catch (error: any) {
    console.error("Error retrieving daily stats:", error);
    throw createError({
      statusCode: error.statusCode || 500,
      statusMessage: error.statusMessage || "Internal server error",
    });
  }
});
