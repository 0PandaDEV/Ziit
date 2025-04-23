import { PrismaClient } from "@prisma/client";
import { TimeRangeEnum, TimeRange, Summary } from "~/lib/stats";
import type { Heartbeats } from "@prisma/client";

const prisma = new PrismaClient();

export async function calculateStats(
  userId: string,
  timeRange: TimeRange,
  midnightOffsetSeconds?: number
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

  const keystrokeTimeoutSeconds = user.keystrokeTimeout * 60;
  const now = Date.now();
  const offsetMs =
    midnightOffsetSeconds !== undefined ? midnightOffsetSeconds * 1000 : 0;

  const userLocalSimulatedDate = new Date(now - offsetMs);
  const userTodayYear = userLocalSimulatedDate.getUTCFullYear();
  const userTodayMonth = userLocalSimulatedDate.getUTCMonth();
  const userTodayDay = userLocalSimulatedDate.getUTCDate();

  const userTodayStartMs =
    Date.UTC(userTodayYear, userTodayMonth, userTodayDay, 0, 0, 0, 0) +
    offsetMs;
  const userTodayEndMs =
    Date.UTC(userTodayYear, userTodayMonth, userTodayDay, 23, 59, 59, 999) +
    offsetMs;

  const todayStartTimestamp: bigint = BigInt(userTodayStartMs);
  const todayEndTimestamp: bigint = BigInt(userTodayEndMs);

  const oneDayMsNum = 24 * 60 * 60 * 1000;
  const yesterdayStartMs = userTodayStartMs - oneDayMsNum;
  const yesterdayEndMs = userTodayEndMs - oneDayMsNum;
  const yesterdayStartTimestamp: bigint = BigInt(yesterdayStartMs);
  const yesterdayEndTimestamp: bigint = BigInt(yesterdayEndMs);

  let fetchStartTimestamp: bigint;
  let fetchEndTimestamp: bigint;
  let isSingleDayView = false;

  if (timeRange === TimeRangeEnum.TODAY) {
    fetchStartTimestamp = todayStartTimestamp;
    fetchEndTimestamp = BigInt(now);
    isSingleDayView = true;
  } else if (timeRange === TimeRangeEnum.YESTERDAY) {
    fetchStartTimestamp = yesterdayStartTimestamp;
    fetchEndTimestamp = yesterdayEndTimestamp;
    isSingleDayView = true;
  } else if (timeRange === TimeRangeEnum.WEEK) {
    const weekStart = new Date(Number(todayStartTimestamp));
    weekStart.setUTCDate(weekStart.getUTCDate() - 6);
    fetchStartTimestamp = BigInt(weekStart.getTime());
    fetchEndTimestamp = todayEndTimestamp;
  } else if (timeRange === TimeRangeEnum.MONTH) {
    const monthStart = new Date(Number(todayStartTimestamp));
    monthStart.setUTCDate(monthStart.getUTCDate() - 29);
    fetchStartTimestamp = BigInt(monthStart.getTime());
    fetchEndTimestamp = todayEndTimestamp;
  } else if (timeRange === TimeRangeEnum.MONTH_TO_DATE) {
    const userLocalFirstDayOfMonth = new Date(now - offsetMs);
    userLocalFirstDayOfMonth.setUTCDate(1);
    const userMonthStartYear = userLocalFirstDayOfMonth.getUTCFullYear();
    const userMonthStartMonth = userLocalFirstDayOfMonth.getUTCMonth();
    fetchStartTimestamp = BigInt(
      Date.UTC(userMonthStartYear, userMonthStartMonth, 1, 0, 0, 0, 0) +
        offsetMs
    );
    fetchEndTimestamp = todayEndTimestamp;
  } else if (timeRange === TimeRangeEnum.LAST_MONTH) {
    const userLocalLastDayOfPrevMonth = new Date(now - offsetMs);
    userLocalLastDayOfPrevMonth.setUTCDate(0);
    const userPrevMonthYear = userLocalLastDayOfPrevMonth.getUTCFullYear();
    const userPrevMonthMonth = userLocalLastDayOfPrevMonth.getUTCMonth();
    const userPrevMonthDay = userLocalLastDayOfPrevMonth.getUTCDate();

    fetchEndTimestamp = BigInt(
      Date.UTC(
        userPrevMonthYear,
        userPrevMonthMonth,
        userPrevMonthDay,
        23,
        59,
        59,
        999
      ) + offsetMs
    );

    const userLocalFirstDayOfPrevMonth = new Date(
      Number(fetchEndTimestamp) - offsetMs
    );
    userLocalFirstDayOfPrevMonth.setUTCDate(1);
    const userPrevMonthStartYear =
      userLocalFirstDayOfPrevMonth.getUTCFullYear();
    const userPrevMonthStartMonth = userLocalFirstDayOfPrevMonth.getUTCMonth();
    fetchStartTimestamp = BigInt(
      Date.UTC(userPrevMonthStartYear, userPrevMonthStartMonth, 1, 0, 0, 0, 0) +
        offsetMs
    );
  } else if (timeRange === TimeRangeEnum.LAST_90_DAYS) {
    const ninetyDaysAgo = new Date(Number(todayStartTimestamp));
    ninetyDaysAgo.setUTCDate(ninetyDaysAgo.getUTCDate() - 89);
    fetchStartTimestamp = BigInt(ninetyDaysAgo.getTime());
    fetchEndTimestamp = todayEndTimestamp;
  } else if (timeRange === TimeRangeEnum.YEAR_TO_DATE) {
    const userLocalFirstDayOfYear = new Date(now - offsetMs);
    const userYearStartYear = userLocalFirstDayOfYear.getUTCFullYear();
    fetchStartTimestamp = BigInt(
      Date.UTC(userYearStartYear, 0, 1, 0, 0, 0, 0) + offsetMs
    );
    fetchEndTimestamp = todayEndTimestamp;
  } else if (timeRange === TimeRangeEnum.LAST_12_MONTHS) {
    const twelveMonthsAgo = new Date(Number(todayStartTimestamp));
    twelveMonthsAgo.setUTCFullYear(twelveMonthsAgo.getUTCFullYear() - 1);

    const targetDate = new Date(now - offsetMs);
    targetDate.setUTCFullYear(targetDate.getUTCFullYear() - 1);
    const targetYear = targetDate.getUTCFullYear();
    const targetMonth = targetDate.getUTCMonth();
    const targetDay = targetDate.getUTCDate();
    fetchStartTimestamp = BigInt(
      Date.UTC(targetYear, targetMonth, targetDay, 0, 0, 0, 0) + offsetMs
    );
    fetchEndTimestamp = todayEndTimestamp;
  } else if (timeRange === TimeRangeEnum.ALL_TIME) {
    fetchStartTimestamp = BigInt(0);
    fetchEndTimestamp = todayEndTimestamp;
  } else {
    fetchStartTimestamp = todayStartTimestamp;
    fetchEndTimestamp = todayEndTimestamp;
    isSingleDayView = true;
  }

  const summaryMap = new Map<string, Summary>();
  let heartbeats: Heartbeats[] = [];

  if (!isSingleDayView) {
    const startDate = new Date(Number(fetchStartTimestamp));
    const endDate = new Date(Number(fetchEndTimestamp));

    const summaries = await prisma.summaries.findMany({
      where: {
        userId,
        date: {
          gte: startDate,
          lte: endDate,
        },
      },
      select: {
        date: true,
        totalMinutes: true,
        projects: true,
        languages: true,
        editors: true,
        os: true,
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
          projects: summary.projects
            ? JSON.parse(JSON.stringify(summary.projects))
            : {},
          languages: summary.languages
            ? JSON.parse(JSON.stringify(summary.languages))
            : {},
          editors: summary.editors
            ? JSON.parse(JSON.stringify(summary.editors))
            : {},
          os: summary.os ? JSON.parse(JSON.stringify(summary.os)) : {},
          hourlyData: Array(24)
            .fill(null)
            .map(() => ({ seconds: 0 })),
        });
      }
    }
  } else {
    try {
      heartbeats = await prisma.heartbeats.findMany({
        where: {
          userId,
          timestamp: {
            gte: fetchStartTimestamp,
            lte: fetchEndTimestamp,
          },
        },
        orderBy: {
          timestamp: "asc",
        },
      });

      const viewDateReferenceTimestamp = Number(fetchStartTimestamp);
      const viewDateSimulated = new Date(viewDateReferenceTimestamp - offsetMs);
      const year = viewDateSimulated.getUTCFullYear();
      const month = String(viewDateSimulated.getUTCMonth() + 1).padStart(
        2,
        "0"
      );
      const day = String(viewDateSimulated.getUTCDate()).padStart(2, "0");
      const dateStr = `${year}-${month}-${day}`;

      if (heartbeats.length > 0) {
        summaryMap.set(dateStr, {
          date: dateStr,
          totalSeconds: 0,
          projects: {},
          languages: {},
          editors: {},
          os: {},
          hourlyData: Array(24)
            .fill(null)
            .map(() => ({ seconds: 0 })),
        });

        const summaryData = summaryMap.get(dateStr)!;
        const dateHeartbeats = heartbeats;

        for (let i = 0; i < dateHeartbeats.length; i++) {
          const heartbeat = dateHeartbeats[i];
          const currentTimestamp = Number(heartbeat.timestamp);

          const heartbeatLocalSimulatedDate = new Date(
            currentTimestamp - offsetMs
          );
          const hour = heartbeatLocalSimulatedDate.getUTCHours();

          let secondsToAdd = 30;

          if (i > 0) {
            const prevHeartbeat = dateHeartbeats[i - 1];
            const previousTimestamp = Number(prevHeartbeat.timestamp);
            const diffSeconds = (currentTimestamp - previousTimestamp) / 1000;

            if (diffSeconds < keystrokeTimeoutSeconds) {
              secondsToAdd = diffSeconds;

              const prevHeartbeatLocalSimulatedDate = new Date(
                previousTimestamp - offsetMs
              );
              const prevHour = prevHeartbeatLocalSimulatedDate.getUTCHours();

              if (hour !== prevHour) {
                const hourBoundarySimulated = new Date(
                  currentTimestamp - offsetMs
                );
                hourBoundarySimulated.setUTCMinutes(0, 0, 0);

                const hourBoundaryUTC =
                  hourBoundarySimulated.getTime() + offsetMs;

                const secondsBeforeBoundary =
                  (hourBoundaryUTC - previousTimestamp) / 1000;
                const secondsAfterBoundary =
                  (currentTimestamp - hourBoundaryUTC) / 1000;

                if (
                  secondsBeforeBoundary > 0 &&
                  secondsBeforeBoundary < keystrokeTimeoutSeconds
                ) {
                  if (prevHour >= 0 && prevHour < 24) {
                    summaryData.hourlyData[prevHour].seconds +=
                      secondsBeforeBoundary;
                  }

                  secondsToAdd =
                    secondsAfterBoundary > 0 ? secondsAfterBoundary : 0;
                } else {
                  secondsToAdd = diffSeconds;
                }
              }
            } else {
              secondsToAdd = 30;
            }
          } else {
            secondsToAdd = 30;
          }

          secondsToAdd = Math.max(0, secondsToAdd);

          if (hour >= 0 && hour < 24) {
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

  const returnedOffsetSeconds = midnightOffsetSeconds ?? 0;

  return {
    summaries,
    offsetSeconds: returnedOffsetSeconds,
    debug: {
      serverNow: now,
      serverTimeISO: new Date(now).toISOString(),

      calculatedUserTodayStartUTC: new Date(
        Number(todayStartTimestamp)
      ).toISOString(),
      calculatedUserTodayEndUTC: new Date(
        Number(todayEndTimestamp)
      ).toISOString(),
      fetchStartTime: new Date(Number(fetchStartTimestamp)).toISOString(),
      fetchEndTime: new Date(Number(fetchEndTimestamp)).toISOString(),
      timeRange,
      heartbeatCount: heartbeats.length,

      tzOffsetSeconds: midnightOffsetSeconds,
      tzOffsetHours: midnightOffsetSeconds
        ? midnightOffsetSeconds / 3600
        : undefined,
      firstHeartbeatUserHour:
        heartbeats.length > 0
          ? new Date(Number(heartbeats[0].timestamp) - offsetMs).getUTCHours()
          : null,
    },
  };
}
