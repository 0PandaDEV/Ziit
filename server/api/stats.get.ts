import { PrismaClient } from "@prisma/client";
import { H3Event } from "h3";
import { TimeRangeEnum, TimeRange } from "~/lib/stats";

const prisma = new PrismaClient();

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

    const utcTodayEnd = new Date();
    utcTodayEnd.setUTCHours(23, 59, 59, 999);
    const utcTodayStart = new Date(utcTodayEnd);
    utcTodayStart.setUTCHours(0, 0, 0, 0);

    const utcYesterdayEnd = new Date(utcTodayStart);
    utcYesterdayEnd.setUTCDate(utcYesterdayEnd.getUTCDate() - 1);
    utcYesterdayEnd.setUTCHours(23, 59, 59, 999);
    const utcYesterdayStart = new Date(utcYesterdayEnd);
    utcYesterdayStart.setUTCHours(0, 0, 0, 0);

    const utcTomorrowEnd = new Date(utcTodayEnd);
    utcTomorrowEnd.setUTCDate(utcTomorrowEnd.getUTCDate() + 1);
    utcTomorrowEnd.setUTCHours(23, 59, 59, 999);

    const utcDayBeforeYesterdayStart = new Date(utcYesterdayStart);
    utcDayBeforeYesterdayStart.setUTCDate(
      utcDayBeforeYesterdayStart.getUTCDate() - 1,
    );
    utcDayBeforeYesterdayStart.setUTCHours(0, 0, 0, 0);

    let fetchStartDate: Date;
    let fetchEndDate: Date;

    if (timeRange === TimeRangeEnum.TODAY) {
      fetchStartDate = utcYesterdayStart;
      fetchEndDate = utcTomorrowEnd;
    } else if (timeRange === TimeRangeEnum.YESTERDAY) {
      fetchStartDate = utcDayBeforeYesterdayStart;
      fetchEndDate = utcTodayEnd;
    } else if (timeRange === TimeRangeEnum.WEEK) {
      fetchStartDate = new Date(utcTodayEnd);
      fetchStartDate.setUTCDate(fetchStartDate.getUTCDate() - 7);
      fetchStartDate.setUTCHours(0, 0, 0, 0);
      fetchEndDate = utcTodayEnd;
    } else if (timeRange === TimeRangeEnum.MONTH) {
      fetchStartDate = new Date(utcTodayEnd);
      fetchStartDate.setUTCDate(fetchStartDate.getUTCDate() - 30);
      fetchStartDate.setUTCHours(0, 0, 0, 0);
      fetchEndDate = utcTodayEnd;
    } else if (timeRange === TimeRangeEnum.MONTH_TO_DATE) {
      fetchStartDate = new Date(utcTodayEnd);
      fetchStartDate.setUTCDate(1);
      fetchStartDate.setUTCHours(0, 0, 0, 0);
      fetchEndDate = utcTodayEnd;
    } else if (timeRange === TimeRangeEnum.LAST_MONTH) {
      const lastDayOfLastUTCMonth = new Date(utcTodayStart);
      lastDayOfLastUTCMonth.setUTCDate(0);
      lastDayOfLastUTCMonth.setUTCHours(23, 59, 59, 999);

      const firstDayOfLastUTCMonth = new Date(lastDayOfLastUTCMonth);
      firstDayOfLastUTCMonth.setUTCDate(1);
      firstDayOfLastUTCMonth.setUTCHours(0, 0, 0, 0);

      fetchStartDate = firstDayOfLastUTCMonth;
      fetchEndDate = lastDayOfLastUTCMonth;
    } else if (timeRange === TimeRangeEnum.YEAR_TO_DATE) {
      fetchStartDate = new Date(utcTodayEnd);
      fetchStartDate.setUTCMonth(0, 1);
      fetchStartDate.setUTCHours(0, 0, 0, 0);
      fetchEndDate = utcTodayEnd;
    } else if (timeRange === TimeRangeEnum.LAST_12_MONTHS) {
      fetchStartDate = new Date(utcTodayEnd);
      fetchStartDate.setUTCFullYear(fetchStartDate.getUTCFullYear() - 1);
      fetchStartDate.setUTCHours(0, 0, 0, 0);
      fetchEndDate = utcTodayEnd;
    } else if (timeRange === TimeRangeEnum.ALL_TIME) {
      fetchStartDate = new Date("2020-01-01T00:00:00.000Z");
      fetchEndDate = utcTodayEnd;
    } else {
      fetchStartDate = utcYesterdayStart;
      fetchEndDate = utcTomorrowEnd;
    }

    const summaries = await prisma.dailyProjectSummary.findMany({
      where: {
        userId,
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
        userId,
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
      summaries: summaries.map((s) => ({
        date: s.date.toISOString().split("T")[0],
        totalSeconds: s.totalSeconds,
        projects: { [s.project]: s.totalSeconds },
        languages: {},
        editors: {},
        os: {},
        files: [],
        branches: []
      })),
      heartbeats: heartbeats.map(h => ({
        ...h,
        timestamp: h.timestamp.toISOString(),
        createdAt: h.createdAt.toISOString()
      }))
    };
  } catch (error: unknown) {
    console.error("Error fetching stats:", error);
    throw createError({
      statusCode:
        error instanceof Error && "statusCode" in error
          ? (error as any).statusCode
          : 500,
      message:
        error instanceof Error ? error.message : "Failed to fetch statistics",
    });
  }
});
