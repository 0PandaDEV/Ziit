import { H3Event } from "h3";
import { TimeRangeEnum } from "~/lib/stats";
import type { TimeRange } from "~/lib/stats";
import { createStandardError } from "~/server/utils/error";

export default defineEventHandler(async (event: H3Event) => {
  const userId = event.context.user.id;

  try {
    const query = getQuery(event);
    const timeRange = query.timeRange as TimeRange;
    const midnightOffsetSeconds = query.midnightOffsetSeconds 
      ? parseInt(query.midnightOffsetSeconds as string, 10)
      : undefined;

    if (!timeRange || !Object.values(TimeRangeEnum).includes(timeRange)) {
      throw createStandardError(400, `Invalid timeRange value ${timeRange}`);
    }

    return await calculateStats(userId, timeRange, midnightOffsetSeconds);
  } catch (error: unknown) {
    console.error("Stats error occurred:", error);
    throw createStandardError(
      error instanceof Error && "statusCode" in error
        ? (error as any).statusCode
        : 500,
      error instanceof Error ? error.message : "Unknown error"
    );
  }
});
