import { PrismaClient } from "@prisma/client";
import { TimeRangeEnum, TimeRange, HourlyData, Summary } from "~/lib/stats";
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
    now.toLocaleString("en-US", { timeZone: userTimezone })
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
        parseInt(seconds)
      )
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

  const summaryMap = new Map<string, Summary>();

  let heartbeats: Heartbeats[] = [];

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

      if (!summaryMap.has(dateStr)) {
        summaryMap.set(dateStr, {
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

      const summaryData = summaryMap.get(dateStr)!;

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
          categoryCounters.projects
        )) {
          const seconds = Math.round((count / totalHeartbeats) * totalSeconds);
          summaryData.projects[project] =
            (summaryData.projects[project] || 0) + seconds;
        }

        for (const [language, count] of Object.entries(
          categoryCounters.languages
        )) {
          const seconds = Math.round((count / totalHeartbeats) * totalSeconds);
          summaryData.languages[language] =
            (summaryData.languages[language] || 0) + seconds;
        }

        for (const [editor, count] of Object.entries(
          categoryCounters.editors
        )) {
          const seconds = Math.round((count / totalHeartbeats) * totalSeconds);
          summaryData.editors[editor] =
            (summaryData.editors[editor] || 0) + seconds;
        }

        for (const [os, count] of Object.entries(categoryCounters.os)) {
          const seconds = Math.round((count / totalHeartbeats) * totalSeconds);
          summaryData.os[os] = (summaryData.os[os] || 0) + seconds;
        }
      }
    }

    const hourlyHeartbeats = await prisma.heartbeats.findMany({
      where: {
        userId,
        timestamp: {
          gte: fetchStartDate,
          lte: fetchEndDate,
        },
      },
      select: {
        timestamp: true,
        file: true,
        editor: true,
        language: true,
        branch: true,
        os: true,
      },
      orderBy: {
        timestamp: "asc",
      },
    });

    const hourlyMap = new Map<string, Map<number, HourlyData>>();

    for (const hb of hourlyHeartbeats) {
      const date = new Date(hb.timestamp);
      const dateStr = date.toISOString().split('T')[0];
      const hourNum = date.getUTCHours();
      
      if (!hourlyMap.has(dateStr)) {
        hourlyMap.set(dateStr, new Map());
      }
      
      const dateMap = hourlyMap.get(dateStr)!;
      if (!dateMap.has(hourNum)) {
        dateMap.set(hourNum, {
          seconds: 30,
        });
      } else {
        const hourData = dateMap.get(hourNum)!;
        hourData.seconds += 30;
      }
    }

    for (const [dateStr, hoursMap] of hourlyMap.entries()) {
      if (summaryMap.has(dateStr)) {
        const summaryData = summaryMap.get(dateStr)!;
        
        for (const [hour, data] of hoursMap.entries()) {
          summaryData.hourlyData[hour] = data;
        }
      }
    }
  } else {
    try {
      heartbeats = await prisma.heartbeats.findMany({
        where: {
          userId,
          timestamp: {
            gte: fetchStartDate,
            lte: fetchEndDate
          }
        },
        orderBy: {
          timestamp: "asc",
        },
      });

      const targetDate =
        timeRange === TimeRangeEnum.TODAY ? todayStart : yesterdayStart;
      const targetDateStr = targetDate.toLocaleDateString("en-CA", {
        timeZone: userTimezone,
      });

      const filteredHeartbeats = heartbeats.filter((heartbeat) => {
        const localDate = new Date(
          heartbeat.timestamp.toLocaleString("en-US", { timeZone: userTimezone })
        );
        const localDateStr = localDate.toLocaleDateString("en-CA", {
          timeZone: userTimezone,
        });

        return localDateStr === targetDateStr;
      });

      heartbeats = filteredHeartbeats;
      const heartbeatsByDate = new Map<string, Array<(typeof heartbeats)[0]>>();

      for (const heartbeat of heartbeats) {
        const localTimestamp = new Date(
          heartbeat.timestamp.toLocaleString("en-US", { timeZone: userTimezone })
        );
        const dateStr = localTimestamp.toISOString().split("T")[0];

        if (!heartbeatsByDate.has(dateStr)) {
          heartbeatsByDate.set(dateStr, []);
        }

        heartbeatsByDate.get(dateStr)!.push(heartbeat);
      }

      for (const [dateStr, dateHeartbeats] of heartbeatsByDate.entries()) {
        if (!summaryMap.has(dateStr)) {
          summaryMap.set(dateStr, {
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

        const summaryData = summaryMap.get(dateStr)!;

        dateHeartbeats.sort(
          (a, b) => a.timestamp.getTime() - b.timestamp.getTime()
        );

        for (let i = 0; i < dateHeartbeats.length; i++) {
          const heartbeat = dateHeartbeats[i];
          const localTimestamp = new Date(
            heartbeat.timestamp.toLocaleString("en-US", {
              timeZone: userTimezone,
            })
          );
          const hour = localTimestamp.getHours();

          let secondsToAdd = 30;

          if (i > 0) {
            const current = heartbeat.timestamp.getTime();
            const previous = dateHeartbeats[i - 1].timestamp.getTime();
            const diffSeconds = (current - previous) / 1000;

            const prevHeartbeat = dateHeartbeats[i - 1];
            const prevLocalTimestamp = new Date(
              prevHeartbeat.timestamp.toLocaleString("en-US", {
                timeZone: userTimezone,
              })
            );
            const prevHour = prevLocalTimestamp.getHours();

            if (diffSeconds < keystrokeTimeoutSeconds) {
              secondsToAdd = diffSeconds;

              if (hour !== prevHour) {
                const hourBoundary = new Date(heartbeat.timestamp);
                hourBoundary.setMinutes(0, 0, 0);
                
                const localHourBoundary = new Date(
                  hourBoundary.toLocaleString("en-US", {
                    timeZone: userTimezone,
                  })
                );
                localHourBoundary.setMinutes(0, 0, 0);
                
                const utcHourBoundary = convertToUTC(localHourBoundary);

                const secondsBeforeBoundary =
                  (utcHourBoundary.getTime() - previous) / 1000;
                const secondsAfterBoundary =
                  (current - utcHourBoundary.getTime()) / 1000;

                if (
                  secondsBeforeBoundary > 0 &&
                  secondsBeforeBoundary < keystrokeTimeoutSeconds
                ) {
                  summaryData.hourlyData[prevHour].seconds += secondsBeforeBoundary;
                  secondsToAdd = secondsAfterBoundary;
                }
              }
            }
          }

          summaryData.totalSeconds += secondsToAdd;
          summaryData.hourlyData[hour].seconds += secondsToAdd;

          if (heartbeat.project) {
            summaryData.projects[heartbeat.project] =
              (summaryData.projects[heartbeat.project] || 0) + secondsToAdd;
          }

          if (heartbeat.language) {
            summaryData.languages[heartbeat.language] =
              (summaryData.languages[heartbeat.language] || 0) + secondsToAdd;
          }

          if (heartbeat.editor) {
            summaryData.editors[heartbeat.editor] =
              (summaryData.editors[heartbeat.editor] || 0) + secondsToAdd;
          }

          if (heartbeat.os) {
            summaryData.os[heartbeat.os] =
              (summaryData.os[heartbeat.os] || 0) + secondsToAdd;
          }
        }
      }
    } catch (error) {
      console.error("Error calculating stats for single day view:", error);
      throw createError({
        statusCode: 500,
        message: `Error calculating stats: ${error instanceof Error ? error.message : String(error)}`,
      });
    }
  }

  const summaries = Array.from(summaryMap.values()).sort((a, b) =>
    a.date.localeCompare(b.date)
  );

  return {
    summaries,
    heartbeats: isSingleDayView
      ? heartbeats.map((h) => ({
          ...h,
          timestamp: h.timestamp.toISOString(),
          createdAt: h.createdAt.toISOString(),
        }))
      : [],
    timezone: userTimezone,
  };
}
