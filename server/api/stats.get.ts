import { H3Event } from "h3";
import { TimeRangeEnum } from "~/lib/stats";
import type { TimeRange } from "~/lib/stats";
import { handleApiError} from "~/server/utils/logging";
import { calculateStats } from "~/server/utils/stats";

export default defineEventHandler(async (event: H3Event) => {
  const userId = event.context.user.id;

  try {
    const query = getQuery(event);
    const timeRange = query.timeRange as TimeRange;
    const midnightOffsetSeconds = query.midnightOffsetSeconds
      ? parseInt(query.midnightOffsetSeconds as string, 10)
      : undefined;

    if (!timeRange || !Object.values(TimeRangeEnum).includes(timeRange)) {
      throw handleApiError(
        400,
        `Invalid timeRange value: ${timeRange}. User ID: ${userId}`,
        "Invalid time range specified."
      );
    }

    return await calculateStats(userId, timeRange, midnightOffsetSeconds);
  } catch (error: any) {
    if (error && typeof error === "object" && error.statusCode) throw error;
    const detailedMessageBase = error instanceof Error ? error.message : "Unknown error in stats endpoint";
    const detailedMessage = `Stats endpoint failed for user ${userId}. Original error: ${detailedMessageBase}`;
    throw handleApiError(
      500,
      detailedMessage,
      "Failed to retrieve statistics."
    );
  }
});
