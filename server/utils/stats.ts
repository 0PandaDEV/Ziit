import { PrismaClient } from "@prisma/client";
import { TimeRangeEnum, TimeRange } from "~/lib/stats";
import type { Heartbeats } from "@prisma/client";

const prisma = new PrismaClient();

export async function calculateStats(userId: string, timeRange: TimeRange) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      keystrokeTimeout: true,
      timezone: true,
    },
  });

  if (!user) {
    throw createError({
      statusCode: 404,
      message: "User not found",
    });
  }

  const keystrokeTimeoutSeconds = user.keystrokeTimeout * 60;
  const userTimezone = user.timezone || "UTC";

  const now = new Date();
  const userNow = new Date(
    now.toLocaleString("en-US", { timeZone: userTimezone }),
  );

  const todayEnd = new Date(userNow);
  todayEnd.setHours(23, 59, 59, 999);

  const todayStart = new Date(todayEnd);
  todayStart.setHours(0, 0, 0, 0);

  const yesterdayEnd = new Date(todayStart);
  yesterdayEnd.setDate(yesterdayEnd.getDate() - 1);
  yesterdayEnd.setHours(23, 59, 59, 999);

  const yesterdayStart = new Date(yesterdayEnd);
  yesterdayStart.setHours(0, 0, 0, 0);

  const tomorrowEnd = new Date(todayEnd);
  tomorrowEnd.setDate(tomorrowEnd.getDate() + 1);
  tomorrowEnd.setHours(23, 59, 59, 999);

  const dayBeforeYesterdayStart = new Date(yesterdayStart);
  dayBeforeYesterdayStart.setDate(dayBeforeYesterdayStart.getDate() - 1);
  dayBeforeYesterdayStart.setHours(0, 0, 0, 0);

  const convertToUTC = (date: Date) => {
    const dateStr = date.toLocaleString("en-US", {
      timeZone: userTimezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    });

    const [datePart, timePart] = dateStr.split(", ");
    const [month, day, year] = datePart.split("/");
    const [hours, minutes, seconds] = timePart.split(":");

    return new Date(
      Date.UTC(
        parseInt(year),
        parseInt(month) - 1,
        parseInt(day),
        parseInt(hours),
        parseInt(minutes),
        parseInt(seconds),
      ),
    );
  };

  const utcTodayStart = convertToUTC(todayStart);
  const utcNow = new Date();
  utcNow.setMinutes(utcNow.getMinutes() + 5);
  const utcTodayEnd =
    timeRange === TimeRangeEnum.TODAY ? utcNow : convertToUTC(todayEnd);
  const utcYesterdayStart = convertToUTC(yesterdayStart);
  const utcYesterdayEnd = convertToUTC(yesterdayEnd);

  let fetchStartDate: Date;
  let fetchEndDate: Date;
  let isSingleDayView = false;

  if (timeRange === TimeRangeEnum.TODAY) {
    fetchStartDate = utcTodayStart;
    fetchEndDate = new Date();
    console.log(
      `Using current time for today's end boundary: ${fetchEndDate.toISOString()}`,
    );
    isSingleDayView = true;
  } else if (timeRange === TimeRangeEnum.YESTERDAY) {
    fetchStartDate = utcYesterdayStart;
    fetchEndDate = utcYesterdayEnd;
    isSingleDayView = true;
  } else if (timeRange === TimeRangeEnum.WEEK) {
    fetchStartDate = new Date(utcYesterdayEnd);
    fetchStartDate.setUTCDate(fetchStartDate.getUTCDate() - 6);
    fetchStartDate.setUTCHours(0, 0, 0, 0);
    fetchEndDate = utcYesterdayEnd;
  } else if (timeRange === TimeRangeEnum.MONTH) {
    fetchStartDate = new Date(utcYesterdayEnd);
    fetchStartDate.setUTCDate(fetchStartDate.getUTCDate() - 29);
    fetchStartDate.setUTCHours(0, 0, 0, 0);
    fetchEndDate = utcYesterdayEnd;
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
  } else if (timeRange === TimeRangeEnum.LAST_90_DAYS) {
    fetchStartDate = new Date(utcYesterdayEnd);
    fetchStartDate.setUTCDate(fetchStartDate.getUTCDate() - 89);
    fetchStartDate.setUTCHours(0, 0, 0, 0);
    fetchEndDate = utcYesterdayEnd;
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
    fetchStartDate = utcTodayStart;
    fetchEndDate = utcTodayEnd;
    isSingleDayView = true;
  }

  const dailyDataMap = new Map<
    string,
    {
      date: string;
      totalSeconds: number;
      projects: Record<string, number>;
      languages: Record<string, number>;
      editors: Record<string, number>;
      os: Record<string, number>;
      hourlyData: Array<{
        seconds: number;
        file: string | null;
        editor: string | null;
        language: string | null;
        branch: string | null;
        os: string | null;
      }>;
    }
  >();

  let heartbeats: Heartbeats[] = [];
  const dailySummaries: { date: string; totalSeconds: number }[] = [];

  if (!isSingleDayView) {
    const summaries = await prisma.summaries.findMany({
      where: {
        userId,
        date: {
          gte: fetchStartDate,
          lte: fetchEndDate,
        },
      },
      include: {
        heartbeats: {
          select: {
            project: true,
            language: true,
            editor: true,
            os: true,
          },
        },
      },
      orderBy: {
        date: "asc",
      },
    });

    for (const summary of summaries) {
      const dateStr = summary.date.toISOString().split("T")[0];

      dailySummaries.push({
        date: dateStr,
        totalSeconds: summary.totalMinutes * 60,
      });

      if (!dailyDataMap.has(dateStr)) {
        dailyDataMap.set(dateStr, {
          date: dateStr,
          totalSeconds: summary.totalMinutes * 60,
          projects: {},
          languages: {},
          editors: {},
          os: {},
          hourlyData: Array(24)
            .fill(null)
            .map(() => ({
              seconds: 0,
              file: null,
              editor: null,
              language: null,
              branch: null,
              os: null,
            })),
        });
      }

      const dailyData = dailyDataMap.get(dateStr)!;

      const categoryCounters = {
        projects: {} as Record<string, number>,
        languages: {} as Record<string, number>,
        editors: {} as Record<string, number>,
        os: {} as Record<string, number>,
      };

      for (const heartbeat of summary.heartbeats) {
        if (heartbeat.project) {
          categoryCounters.projects[heartbeat.project] =
            (categoryCounters.projects[heartbeat.project] || 0) + 1;
        }
        if (heartbeat.language) {
          categoryCounters.languages[heartbeat.language] =
            (categoryCounters.languages[heartbeat.language] || 0) + 1;
        }
        if (heartbeat.editor) {
          categoryCounters.editors[heartbeat.editor] =
            (categoryCounters.editors[heartbeat.editor] || 0) + 1;
        }
        if (heartbeat.os) {
          categoryCounters.os[heartbeat.os] =
            (categoryCounters.os[heartbeat.os] || 0) + 1;
        }
      }

      const totalHeartbeats = summary.heartbeats.length;
      const totalSeconds = summary.totalMinutes * 60;

      if (totalHeartbeats > 0) {
        for (const [project, count] of Object.entries(
          categoryCounters.projects,
        )) {
          const seconds = Math.round((count / totalHeartbeats) * totalSeconds);
          dailyData.projects[project] =
            (dailyData.projects[project] || 0) + seconds;
        }

        for (const [language, count] of Object.entries(
          categoryCounters.languages,
        )) {
          const seconds = Math.round((count / totalHeartbeats) * totalSeconds);
          dailyData.languages[language] =
            (dailyData.languages[language] || 0) + seconds;
        }

        for (const [editor, count] of Object.entries(
          categoryCounters.editors,
        )) {
          const seconds = Math.round((count / totalHeartbeats) * totalSeconds);
          dailyData.editors[editor] =
            (dailyData.editors[editor] || 0) + seconds;
        }

        for (const [os, count] of Object.entries(categoryCounters.os)) {
          const seconds = Math.round((count / totalHeartbeats) * totalSeconds);
          dailyData.os[os] = (dailyData.os[os] || 0) + seconds;
        }
      }
    }
  } else {
    console.log(
      `Fetching heartbeats for ${timeRange} in timezone ${userTimezone}`,
    );

    let query: any = {
      userId,
    };

    if (timeRange === TimeRangeEnum.YESTERDAY) {
      const oneDayAgo = new Date();
      oneDayAgo.setDate(oneDayAgo.getDate() - 1);
      query.timestamp = {
        gte: oneDayAgo,
      };
    } else if (timeRange === TimeRangeEnum.TODAY) {
      const twoDaysAgo = new Date();
      twoDaysAgo.setDate(twoDaysAgo.getDate() - 2);
      query.timestamp = {
        gte: twoDaysAgo,
      };
    }

    console.log(`Using query: ${JSON.stringify(query)}`);

    heartbeats = await prisma.heartbeats.findMany({
      where: query,
      orderBy: {
        timestamp: "asc",
      },
    });

    console.log(`Fetched ${heartbeats.length} heartbeats initially`);

    const targetDate =
      timeRange === TimeRangeEnum.TODAY ? todayStart : yesterdayStart;
    const targetDateStr = targetDate.toLocaleDateString("en-CA", {
      timeZone: userTimezone,
    });

    console.log(`Target date in ${userTimezone}: ${targetDateStr}`);

    const filteredHeartbeats = heartbeats.filter((heartbeat) => {
      const localDate = new Date(
        heartbeat.timestamp.toLocaleString("en-US", { timeZone: userTimezone }),
      );
      const localDateStr = localDate.toLocaleDateString("en-CA", {
        timeZone: userTimezone,
      });

      return localDateStr === targetDateStr;
    });

    heartbeats = filteredHeartbeats;

    console.log(
      `After timezone filtering: ${heartbeats.length} heartbeats remain for ${targetDateStr}`,
    );
    console.log(
      `First heartbeat time: ${heartbeats.length > 0 ? heartbeats[0].timestamp.toISOString() : "none"}`,
    );
    console.log(
      `Last heartbeat time: ${heartbeats.length > 0 ? heartbeats[heartbeats.length - 1].timestamp.toISOString() : "none"}`,
    );

    const heartbeatsByDate = new Map<string, Array<(typeof heartbeats)[0]>>();

    for (const heartbeat of heartbeats) {
      const localTimestamp = new Date(
        heartbeat.timestamp.toLocaleString("en-US", { timeZone: userTimezone }),
      );
      const dateStr = localTimestamp.toISOString().split("T")[0];

      if (!heartbeatsByDate.has(dateStr)) {
        heartbeatsByDate.set(dateStr, []);
      }

      heartbeatsByDate.get(dateStr)!.push(heartbeat);
    }

    console.log(
      `Heartbeats grouped by date: ${Array.from(heartbeatsByDate.keys()).join(", ")}`,
    );

    for (const [dateStr, dateHeartbeats] of heartbeatsByDate.entries()) {
      if (!dailyDataMap.has(dateStr)) {
        dailyDataMap.set(dateStr, {
          date: dateStr,
          totalSeconds: 0,
          projects: {},
          languages: {},
          editors: {},
          os: {},
          hourlyData: Array(24)
            .fill(null)
            .map(() => ({
              seconds: 0,
              file: null,
              editor: null,
              language: null,
              branch: null,
              os: null,
            })),
        });
      }

      const dailyData = dailyDataMap.get(dateStr)!;

      dateHeartbeats.sort(
        (a, b) => a.timestamp.getTime() - b.timestamp.getTime(),
      );

      for (let i = 0; i < dateHeartbeats.length; i++) {
        const heartbeat = dateHeartbeats[i];
        const localTimestamp = new Date(
          heartbeat.timestamp.toLocaleString("en-US", {
            timeZone: userTimezone,
          }),
        );
        const hour = localTimestamp.getHours();

        if (heartbeat.editor) {
          dailyData.hourlyData[hour].editor = heartbeat.editor;
        }

        if (heartbeat.language) {
          dailyData.hourlyData[hour].language = heartbeat.language;
        }

        if (heartbeat.os) {
          dailyData.hourlyData[hour].os = heartbeat.os;
        }

        if (heartbeat.file) {
          dailyData.hourlyData[hour].file = heartbeat.file;
        }

        if (heartbeat.branch) {
          dailyData.hourlyData[hour].branch = heartbeat.branch;
        }

        let secondsToAdd = 30;

        if (i > 0) {
          const current = heartbeat.timestamp.getTime();
          const previous = dateHeartbeats[i - 1].timestamp.getTime();
          const diffSeconds = (current - previous) / 1000;

          const prevHour = dateHeartbeats[i - 1].timestamp.getHours();

          if (diffSeconds < keystrokeTimeoutSeconds) {
            secondsToAdd = diffSeconds;

            if (hour !== prevHour) {
              const hourBoundary = new Date(heartbeat.timestamp);
              hourBoundary.setMinutes(0, 0, 0);

              const secondsBeforeBoundary =
                (hourBoundary.getTime() - previous) / 1000;
              const secondsAfterBoundary =
                (current - hourBoundary.getTime()) / 1000;

              if (
                secondsBeforeBoundary > 0 &&
                secondsBeforeBoundary < keystrokeTimeoutSeconds
              ) {
                dailyData.hourlyData[prevHour].seconds += secondsBeforeBoundary;
                secondsToAdd = secondsAfterBoundary;
              }
            }
          }
        }

        dailyData.totalSeconds += secondsToAdd;
        dailyData.hourlyData[hour].seconds += secondsToAdd;

        if (heartbeat.project) {
          dailyData.projects[heartbeat.project] =
            (dailyData.projects[heartbeat.project] || 0) + secondsToAdd;
        }

        if (heartbeat.language) {
          dailyData.languages[heartbeat.language] =
            (dailyData.languages[heartbeat.language] || 0) + secondsToAdd;
        }

        if (heartbeat.editor) {
          dailyData.editors[heartbeat.editor] =
            (dailyData.editors[heartbeat.editor] || 0) + secondsToAdd;
        }

        if (heartbeat.os) {
          dailyData.os[heartbeat.os] =
            (dailyData.os[heartbeat.os] || 0) + secondsToAdd;
        }
      }

      dailySummaries.push({
        date: dateStr,
        totalSeconds: dailyData.totalSeconds,
      });
    }
  }

  const dailyData = Array.from(dailyDataMap.values()).sort((a, b) =>
    a.date.localeCompare(b.date),
  );

  return {
    summaries: dailyData,
    heartbeats: isSingleDayView
      ? heartbeats.map((h) => ({
          ...h,
          timestamp: h.timestamp.toISOString(),
          createdAt: h.createdAt.toISOString(),
        }))
      : [],
    dailySummaries: dailySummaries.sort((a, b) => a.date.localeCompare(b.date)),
    timezone: userTimezone,
  };
}
