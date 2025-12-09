import { H3Event } from "h3";
import { TimeRangeEnum } from "~/utils/stats";
import type { TimeRange } from "~/utils/stats";
import { z } from "zod";
import { calculateStats } from "~~/server/utils/stats";
import { handleApiError } from "~~/server/utils/logging";
import { prisma } from "~~/prisma/db";

defineRouteMeta({
  openAPI: {
    tags: ["External", "Stats"],
    summary: "Get stats via API key",
    description:
      "Returns aggregated stats for the user identified by the Bearer API key.",
    security: [{ bearerAuth: [] }],
    parameters: [
      {
        in: "query",
        name: "timeRange",
        required: false,
        schema: { type: "string", enum: Object.values(TimeRangeEnum) as any },
      },
      {
        in: "query",
        name: "midnightOffsetSeconds",
        required: false,
        schema: { type: "integer" },
      },
    ],
    responses: {
      200: { description: "Stats result" },
      400: { description: "Invalid parameters" },
      401: { description: "Invalid or missing API key" },
      500: { description: "Server error" },
    },
    operationId: "getExternalStats",
  },
});

const apiKeySchema = z.uuid();

export default defineEventHandler(async (event: H3Event) => {
  try {
    const authHeader = getHeader(event, "authorization");
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      throw handleApiError(
        401,
        "External Stats API: Missing or invalid API key format in header.",
        "API key is missing or improperly formatted."
      );
    }

    const apiKey = authHeader.substring(7);
    const validationResult = apiKeySchema.safeParse(apiKey);

    if (!validationResult.success) {
      throw handleApiError(
        401,
        `External Stats API: Invalid API key format. Key prefix: ${apiKey.substring(0, 4)}...`,
        "Invalid API key format."
      );
    }

    const user = await prisma.user.findUnique({
      where: { apiKey },
      select: { id: true, apiKey: true },
    });

    if (!user || user.apiKey !== apiKey) {
      throw handleApiError(
        401,
        `External Stats API: Invalid API key. Key prefix: ${apiKey.substring(0, 4)}...`,
        "Invalid API key."
      );
    }

    const query = getQuery(event);
    const timeRange = String(query.timeRange || "today");
    const midnightOffsetSeconds = query.midnightOffsetSeconds
      ? Number(query.midnightOffsetSeconds)
      : undefined;

    if (!Object.values(TimeRangeEnum).includes(timeRange as any)) {
      throw handleApiError(
        400,
        `External Stats API: Invalid timeRange value: ${timeRange}. User ID: ${user.id}`,
        "Invalid time range specified."
      );
    }

    return await calculateStats(
      user.id,
      timeRange as TimeRange,
      midnightOffsetSeconds
    );
  } catch (error: any) {
    if (error && typeof error === "object" && error.statusCode) throw error;
    const detailedMessage =
      error instanceof Error
        ? error.message
        : "An unknown error occurred fetching external stats.";
    const apiKeyPrefix =
      getHeader(event, "authorization")?.substring(7, 11) || "UNKNOWN";
    throw handleApiError(
      69,
      `External Stats API: Failed to fetch statistics. API Key prefix: ${apiKeyPrefix}... Error: ${detailedMessage}`,
      "Failed to fetch statistics."
    );
  }
});
