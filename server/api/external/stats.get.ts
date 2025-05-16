import { PrismaClient } from "@prisma/client";
import { H3Event } from "h3";
import { TimeRangeEnum } from "~/lib/stats";
import type { TimeRange } from "~/lib/stats";
import { z } from "zod";
import { calculateStats } from "~/server/utils/stats";
import { handleApiError } from "~/server/utils/error";

const prisma = new PrismaClient();

const apiKeySchema = z.string().uuid();

export default defineEventHandler(async (event: H3Event) => {
  try {
    const authHeader = getHeader(event, "authorization");
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      throw handleApiError(401, "External Stats API: Missing or invalid API key format in header.");
    }

    const apiKey = authHeader.substring(7);
    const validationResult = apiKeySchema.safeParse(apiKey);

    if (!validationResult.success) {
      throw handleApiError(401, `External Stats API: Invalid API key format. Key prefix: ${apiKey.substring(0,4)}...`);
    }

    const user = await prisma.user.findUnique({
      where: { apiKey },
      select: { id: true, apiKey: true },
    });

    if (!user || user.apiKey !== apiKey) {
      throw handleApiError(401, `External Stats API: Invalid API key. Key prefix: ${apiKey.substring(0,4)}...`);
    }

    const query = getQuery(event);
    const timeRange = String(query.timeRange || "today");
    const midnightOffsetSeconds = query.midnightOffsetSeconds ? Number(query.midnightOffsetSeconds) : undefined;

    if (!Object.values(TimeRangeEnum).includes(timeRange as any)) {
      throw handleApiError(400, `External Stats API: Invalid timeRange value: ${timeRange}. User ID: ${user.id}`);
    }

    return await calculateStats(user.id, timeRange as TimeRange, midnightOffsetSeconds);
  } catch (error: any) {
    const apiKeyPrefix = getHeader(event, "authorization")?.substring(7,11);
    return handleApiError(error, `External Stats API: Failed to fetch statistics. API Key prefix: ${apiKeyPrefix}...`);
  }
});
