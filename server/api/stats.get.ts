import { H3Event } from "h3";
import { TimeRangeEnum } from "~/lib/stats";
import type { TimeRange } from "~/lib/stats";

export default defineEventHandler(async (event: H3Event) => {
  const userId = event.context.user.id;

  try {
    const query = getQuery(event);
    const timeRange = query.timeRange as TimeRange;
    const midnightOffsetSeconds = query.midnightOffsetSeconds 
      ? parseInt(query.midnightOffsetSeconds as string, 10)
      : undefined;

    if (!timeRange || !Object.values(TimeRangeEnum).includes(timeRange)) {
      console.error(`Stats error: Invalid timeRange value ${timeRange}`);
      throw createError({
        statusCode: 400,
        message: "Invalid timeRange value",
      });
    }

    return await calculateStats(userId, timeRange, midnightOffsetSeconds);
  } catch (error: unknown) {
    console.error("Stats error occurred:", error);
    throw createError({
      statusCode:
        error instanceof Error && "statusCode" in error
          ? (error as any).statusCode
          : 500,
      message: "Failed to fetch statistics",
    });
  }
});
