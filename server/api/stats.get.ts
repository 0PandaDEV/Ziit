import { PrismaClient, Heartbeat } from "@prisma/client";
import { H3Event } from "h3";
import { TimeRangeEnum, TimeRange } from "~/lib/stats";

const prisma = new PrismaClient();
const HEARTBEAT_INTERVAL_SECONDS = 30;

type HourlyData = {
  timestamp: string;
  totalSeconds: number;
};

type DailyStats = {
  date: string;
  totalSeconds: number;
  projects: Record<string, number>;
  languages: Record<string, number>;
  editors: Record<string, number>;
  os: Record<string, number>;
  files: string[];
  hourlyData?: HourlyData[];
};

type HeartbeatsByDayAndProject = Record<string, Record<string, Heartbeat[]>>;

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

    const today = new Date();
    today.setHours(23, 59, 59, 999);

    let startDate = new Date();
    startDate.setHours(0, 0, 0, 0);
    let endDate = today;

    if (timeRange === TimeRangeEnum.YESTERDAY) {
      startDate = new Date(today);
      startDate.setDate(startDate.getDate() - 1);
      startDate.setHours(0, 0, 0, 0);

      endDate = new Date(startDate);
      endDate.setHours(23, 59, 59, 999);
    } else if (timeRange === TimeRangeEnum.WEEK) {
      startDate = new Date(today);
      startDate.setDate(startDate.getDate() - 7);
      startDate.setHours(0, 0, 0, 0);
    } else if (timeRange === TimeRangeEnum.MONTH) {
      startDate = new Date(today);
      startDate.setDate(startDate.getDate() - 30);
      startDate.setHours(0, 0, 0, 0);
    } else if (timeRange === TimeRangeEnum.MONTH_TO_DATE) {
      startDate = new Date(today);
      startDate.setDate(1);
      startDate.setHours(0, 0, 0, 0);
    } else if (timeRange === TimeRangeEnum.LAST_MONTH) {
      endDate = new Date(today);
      endDate.setDate(0);
      endDate.setHours(23, 59, 59, 999);

      startDate = new Date(endDate);
      startDate.setDate(1);
      startDate.setHours(0, 0, 0, 0);
    } else if (timeRange === TimeRangeEnum.YEAR_TO_DATE) {
      startDate = new Date(today);
      startDate.setMonth(0, 1);
      startDate.setHours(0, 0, 0, 0);
    } else if (timeRange === TimeRangeEnum.LAST_12_MONTHS) {
      startDate = new Date(today);
      startDate.setFullYear(startDate.getFullYear() - 1);
      startDate.setHours(0, 0, 0, 0);
    } else if (timeRange === TimeRangeEnum.ALL_TIME) {
      startDate = new Date("2020-01-01");
      startDate.setHours(0, 0, 0, 0);
    }

    const summaries = await prisma.dailyProjectSummary.findMany({
      where: {
        userId,
        date: {
          gte: startDate,
          lte: endDate,
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
          gte: startDate,
          lte: endDate,
        },
      },
      orderBy: {
        timestamp: "asc",
      },
    });

    const dailyStats: Record<string, DailyStats> = {};

    let currentDate = new Date(startDate);
    while (currentDate <= endDate) {
      const dateStr = currentDate.toISOString().split("T")[0];
      dailyStats[dateStr] = {
        date: dateStr,
        totalSeconds: 0,
        projects: {},
        languages: {},
        editors: {},
        os: {},
        files: [],
      };
      currentDate.setDate(currentDate.getDate() + 1);
    }

    for (const summary of summaries) {
      const dateStr = summary.date.toISOString().split("T")[0];

      if (!dailyStats[dateStr]) {
        dailyStats[dateStr] = {
          date: dateStr,
          totalSeconds: 0,
          projects: {},
          languages: {},
          editors: {},
          os: {},
          files: [],
        };
      }

      dailyStats[dateStr].totalSeconds += summary.totalSeconds;
      dailyStats[dateStr].projects[summary.project] =
        (dailyStats[dateStr].projects[summary.project] || 0) +
        summary.totalSeconds;
    }

    const processedDayProjects = new Set<string>();
    summaries.forEach((s) => {
      const dateStr = s.date.toISOString().split("T")[0];
      processedDayProjects.add(`${dateStr}_${s.project}`);
    });

    const heartbeatsByDayAndProject: HeartbeatsByDayAndProject = {};

    heartbeats.forEach((hb) => {
      const dateStr = hb.timestamp.toISOString().split("T")[0];
      const project = hb.project || "unknown";
      const key = `${dateStr}_${project}`;

      if (processedDayProjects.has(key)) {
        return;
      }

      if (!heartbeatsByDayAndProject[dateStr]) {
        heartbeatsByDayAndProject[dateStr] = {};
      }

      if (!heartbeatsByDayAndProject[dateStr][project]) {
        heartbeatsByDayAndProject[dateStr][project] = [];
      }

      heartbeatsByDayAndProject[dateStr][project].push(hb);
    });

    for (const dateStr in heartbeatsByDayAndProject) {
      if (!dailyStats[dateStr]) {
        dailyStats[dateStr] = {
          date: dateStr,
          totalSeconds: 0,
          projects: {},
          languages: {},
          editors: {},
          os: {},
          files: [],
        };
      }

      for (const project in heartbeatsByDayAndProject[dateStr]) {
        const beats = heartbeatsByDayAndProject[dateStr][project];
        let projectSeconds = 0;
        const languages: Record<string, number> = {};
        const editors: Record<string, number> = {};
        const os: Record<string, number> = {};
        const files = new Set<string>();

        beats.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());

        for (let i = 0; i < beats.length; i++) {
          const beat = beats[i];

          if (i === 0) {
            projectSeconds += HEARTBEAT_INTERVAL_SECONDS;
            if (beat.language) {
              languages[beat.language] =
                (languages[beat.language] || 0) + HEARTBEAT_INTERVAL_SECONDS;
            }
            if (beat.editor) {
              editors[beat.editor] =
                (editors[beat.editor] || 0) + HEARTBEAT_INTERVAL_SECONDS;
            }
            if (beat.os) {
              os[beat.os] = (os[beat.os] || 0) + HEARTBEAT_INTERVAL_SECONDS;
            }
            continue;
          }

          const current = beats[i].timestamp.getTime();
          const previous = beats[i - 1].timestamp.getTime();
          const diff = Math.round((current - previous) / 1000);

          if (diff < 300) {
            projectSeconds += diff;

            if (beat.language) {
              languages[beat.language] = (languages[beat.language] || 0) + diff;
            }
            if (beat.editor) {
              editors[beat.editor] = (editors[beat.editor] || 0) + diff;
            }
            if (beat.os) {
              os[beat.os] = (os[beat.os] || 0) + diff;
            }
          } else {
            projectSeconds += HEARTBEAT_INTERVAL_SECONDS;

            if (beat.language) {
              languages[beat.language] =
                (languages[beat.language] || 0) + HEARTBEAT_INTERVAL_SECONDS;
            }
            if (beat.editor) {
              editors[beat.editor] =
                (editors[beat.editor] || 0) + HEARTBEAT_INTERVAL_SECONDS;
            }
            if (beat.os) {
              os[beat.os] = (os[beat.os] || 0) + HEARTBEAT_INTERVAL_SECONDS;
            }
          }
        }

        dailyStats[dateStr].projects[project] =
          (dailyStats[dateStr].projects[project] || 0) + projectSeconds;
        dailyStats[dateStr].totalSeconds += projectSeconds;

        for (const lang in languages) {
          dailyStats[dateStr].languages[lang] =
            (dailyStats[dateStr].languages[lang] || 0) + languages[lang];
        }

        for (const editor in editors) {
          dailyStats[dateStr].editors[editor] =
            (dailyStats[dateStr].editors[editor] || 0) + editors[editor];
        }

        for (const osName in os) {
          dailyStats[dateStr].os[osName] =
            (dailyStats[dateStr].os[osName] || 0) + os[osName];
        }

        dailyStats[dateStr].files.push(...Array.from(files));
      }
    }

    const result = Object.values(dailyStats).filter(
      (day) => day.totalSeconds > 0 || Object.keys(day.projects).length > 0
    );

    result.sort(
      (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()
    );

    if (
      timeRange === TimeRangeEnum.TODAY ||
      timeRange === TimeRangeEnum.YESTERDAY
    ) {
      const targetDate =
        timeRange === TimeRangeEnum.TODAY
          ? today.toISOString().split("T")[0]
          : new Date(today.setDate(today.getDate() - 1))
              .toISOString()
              .split("T")[0];

      const dayHeartbeats = heartbeats.filter(
        (hb) => hb.timestamp.toISOString().split("T")[0] === targetDate
      );

      const hourlyData: HourlyData[] = Array(24)
        .fill(0)
        .map((_, hour) => {
          const hourStart = new Date(targetDate);
          hourStart.setUTCHours(hour, 0, 0, 0);
          const hourEnd = new Date(hourStart);
          hourEnd.setUTCHours(hour + 1, 0, 0, 0);

          const hourBeats = dayHeartbeats.filter(
            (hb) =>
              hb.timestamp.getTime() >= hourStart.getTime() &&
              hb.timestamp.getTime() < hourEnd.getTime()
          );

          let totalSeconds = 0;
          if (hourBeats.length > 0) {
            hourBeats.sort(
              (a, b) => a.timestamp.getTime() - b.timestamp.getTime()
            );

            for (let i = 0; i < hourBeats.length; i++) {
              if (i === 0) {
                totalSeconds += HEARTBEAT_INTERVAL_SECONDS;
              } else {
                const current = hourBeats[i].timestamp.getTime();
                const previous = hourBeats[i - 1].timestamp.getTime();
                const diff = Math.round((current - previous) / 1000);
                totalSeconds += diff < 300 ? diff : HEARTBEAT_INTERVAL_SECONDS;
              }
            }
          }

          return {
            timestamp: hourStart.toISOString(),
            totalSeconds,
          };
        });

      const dayIndex = result.findIndex((day) => day.date === targetDate);
      if (dayIndex !== -1) {
        result[dayIndex] = {
          ...result[dayIndex],
          hourlyData,
        };
      } else {
        result.push({
          date: targetDate,
          totalSeconds: 0,
          projects: {},
          languages: {},
          editors: {},
          os: {},
          files: [],
          hourlyData,
        });
      }
    }

    return result;
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
