import { PrismaClient } from "@prisma/client";
import { H3Event } from "h3";
import { TimeRangeEnum } from "~/lib/stats";
import type { TimeRange } from "~/lib/stats";
import { z } from "zod";
import { calculateStats } from "~/server/utils/stats";
import { createStandardError, handleApiError } from "~/server/utils/error";

const prisma = new PrismaClient();

const apiKeySchema = z.string().uuid();

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

    const query = getQuery(event);
    const timeRange = String(query.timeRange || "today");
    const midnightOffsetSeconds = query.midnightOffsetSeconds ? Number(query.midnightOffsetSeconds) : undefined;

    if (!Object.values(TimeRangeEnum).includes(timeRange as any)) {
      throw createStandardError(400, `Invalid timeRange value: ${timeRange}`);
    }

    return await calculateStats(user.id, timeRange as TimeRange, midnightOffsetSeconds);
  } catch (error: any) {
    return handleApiError(error, "Failed to fetch statistics");
  }
});
