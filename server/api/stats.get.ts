import { H3Event } from "h3";
import { TimeRangeEnum, TimeRange } from "~/lib/stats";
import { calculateStats } from "~/server/utils/stats";

export default defineEventHandler(async (event: H3Event) => {
  if (!event.context.user) {
    throw createError({
      statusCode: 401,
      message: "Unauthorized",
    });
  }

  const userId = event.context.user.id;

  try {
    const query = getQuery(event);
    const timeRange = query.timeRange as TimeRange;

    if (!timeRange || !Object.values(TimeRangeEnum).includes(timeRange)) {
      throw createError({
        statusCode: 400,
        message: "Invalid timeRange value",
      });
    }

    return await calculateStats(userId, timeRange);
  } catch (error: unknown) {
    console.error("Error fetching stats:", error);
    throw createError({
      statusCode: error instanceof Error && "statusCode" in error ? (error as any).statusCode : 500,
      message: error instanceof Error ? error.message : "Failed to fetch statistics",
    });
  }
});
