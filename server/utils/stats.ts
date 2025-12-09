import { TimeRange } from "~/utils/stats";
import { prisma } from "~~/prisma/db";

export async function calculateStats(
  userId: string,
  timeRange: TimeRange,
  midnightOffsetSeconds?: number,
  projectFilter?: string
) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      keystrokeTimeout: true,
    },
  });

  if (!user) {
    throw createError({
      statusCode: 404,
      message: "User not found",
    });
  }

  const timeRangeUpper = timeRange.toUpperCase().replace(/-/g, "_");

  const offsetSeconds = midnightOffsetSeconds ?? 0;

  try {
    const result = await prisma.$queryRaw<Array<any>>`
      SELECT get_user_stats(
        ${userId}::TEXT,
        ${timeRangeUpper}::TEXT,
        ${offsetSeconds}::INT,
        ${projectFilter || null}::TEXT
      ) as stats
    `;

    if (!result || result.length === 0 || !result[0].stats) {
      throw new Error("No data returned from database function");
    }

    const statsData = result[0].stats;

    const parsedStats =
      typeof statsData === "string" ? JSON.parse(statsData) : statsData;

    return {
      summaries: parsedStats.summaries || [],
      offsetSeconds: parsedStats.offsetSeconds || 0,
      ...(parsedStats.projectSeconds !== null &&
        parsedStats.projectSeconds !== undefined && {
          projectSeconds: parsedStats.projectSeconds,
          projectFilter: parsedStats.projectFilter,
        }),
    };
  } catch (error) {
    console.error("Error calculating stats:", error);
    throw createError({
      statusCode: 500,
      message: `Error calculating stats: ${error instanceof Error ? error.message : String(error)}`,
    });
  }
}

export async function getUserTimeRangeTotal(
  userId: string,
  timeRange: TimeRange,
  offsetSeconds?: number
) {
  const timeRangeUpper = timeRange.toUpperCase().replace(/-/g, "_");
  const offset = offsetSeconds ?? 0;

  try {
    const result = await prisma.$queryRaw<
      Array<{
        total_minutes: number;
        total_hours: number;
        start_date: Date;
        end_date: Date;
      }>
    >`
      SELECT * FROM get_user_time_range_total(
        ${userId}::TEXT,
        ${timeRangeUpper}::TEXT,
        ${offset}::INT
      )
    `;

    if (!result || result.length === 0) {
      return {
        totalMinutes: 0,
        totalHours: 0,
        startDate: new Date(),
        endDate: new Date(),
      };
    }

    return {
      totalMinutes: result[0].total_minutes,
      totalHours: result[0].total_hours,
      startDate: result[0].start_date,
      endDate: result[0].end_date,
    };
  } catch (error) {
    console.error("Error getting time range total:", error);
    throw createError({
      statusCode: 500,
      message: `Error getting time range total: ${error instanceof Error ? error.message : String(error)}`,
    });
  }
}
