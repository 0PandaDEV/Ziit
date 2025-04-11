import { PrismaClient } from "@prisma/client";
import { H3Event } from "h3";
import { TimeRangeEnum, TimeRange } from "~/lib/stats";
import { z } from "zod";
import { calculateStats } from "~/server/utils/stats";

const prisma = new PrismaClient();

const apiKeySchema = z.string().uuid();

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
    const validationResult = apiKeySchema.safeParse(apiKey);

    if (!validationResult.success) {
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
      throw createError({
        statusCode: 401,
        statusMessage: "Unauthorized: Invalid API key",
      });
    }

    const query = getQuery(event);
    const timeRange = query.timeRange as TimeRange;

    if (!timeRange || !Object.values(TimeRangeEnum).includes(timeRange)) {
      throw createError({
        statusCode: 400,
        message: "Invalid timeRange value",
      });
    }

    return await calculateStats(user.id, timeRange);
  } catch (error: any) {
    console.error("Error retrieving daily stats:", error);
    throw createError({
      statusCode: error.statusCode || 500,
      statusMessage: error.statusMessage || "Internal server error",
    });
  }
});
