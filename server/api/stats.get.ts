import { PrismaClient, Heartbeat } from "@prisma/client";
import { H3Event } from "h3";

const prisma = new PrismaClient();
const HEARTBEAT_INTERVAL_SECONDS = 30;

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
    const startDateStr = query.startDate as string;
    const endDateStr = (query.endDate as string) || new Date().toISOString();

    if (!startDateStr) {
      throw createError({
        statusCode: 400,
        message: "startDate is required",
      });
    }

    const startDate = new Date(startDateStr);
    const endDate = new Date(endDateStr);

    if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
      throw createError({
        statusCode: 400,
        message: "Invalid date format",
      });
    }

    const startISODate = startDate.toISOString().split("T")[0];
    const endISODate = endDate.toISOString().split("T")[0];

    const startDateOnly = new Date(startISODate);
    const endDateOnly = new Date(endISODate);
    endDateOnly.setHours(23, 59, 59, 999);

    const summaries = await prisma.dailyProjectSummary.findMany({
      where: {
        userId,
        date: {
          gte: startDateOnly,
          lte: endDateOnly,
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
          gte: startDateOnly,
          lte: endDateOnly,
        },
      },
      orderBy: {
        timestamp: "asc",
      },
    });

    const dailyStats: Record<
      string,
      {
        date: string;
        totalSeconds: number;
        projects: Record<string, number>;
        languages: Record<string, number>;
        editors: Record<string, number>;
        os: Record<string, number>;
        files: string[];
      }
    > = {};

    let currentDate = new Date(startDateOnly);
    while (currentDate <= endDateOnly) {
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

    const heartbeatsByDayAndProject: Record<
      string,
      Record<string, Heartbeat[]>
    > = {};

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

    const daysWithSummariesButNoDetails = summaries
      .map((s) => s.date.toISOString().split("T")[0])
      .filter((dateStr) => {
        return (
          dailyStats[dateStr] &&
          (!dailyStats[dateStr].languages ||
            Object.keys(dailyStats[dateStr].languages).length === 0)
        );
      });

    for (const dateStr of daysWithSummariesButNoDetails) {
      const dayHeartbeats = heartbeats.filter(
        (hb) => hb.timestamp.toISOString().split("T")[0] === dateStr
      );

      const languages: Record<string, number> = {};
      const editors: Record<string, number> = {};
      const os: Record<string, number> = {};
      const files = new Set<string>();

      dayHeartbeats.forEach((hb) => {
        if (
          hb.language &&
          dailyStats[dateStr].projects[hb.project || "unknown"]
        ) {
          const projectTime =
            dailyStats[dateStr].projects[hb.project || "unknown"];
          const totalBeats = dayHeartbeats.filter(
            (b) => b.project === hb.project
          ).length;

          if (totalBeats > 0) {
            const approxTimePerBeat = projectTime / totalBeats;
            languages[hb.language] =
              (languages[hb.language] || 0) + approxTimePerBeat;

            if (hb.editor) {
              editors[hb.editor] =
                (editors[hb.editor] || 0) + approxTimePerBeat;
            }
            if (hb.os) {
              os[hb.os] = (os[hb.os] || 0) + approxTimePerBeat;
            }
          }
        }
      });

      dailyStats[dateStr].languages = languages;
      dailyStats[dateStr].editors = editors;
      dailyStats[dateStr].os = os;
      dailyStats[dateStr].files = Array.from(files);
    }

    const result = Object.values(dailyStats).filter(
      (day) => day.totalSeconds > 0 || Object.keys(day.projects).length > 0
    );

    result.sort(
      (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()
    );

    return result;
  } catch (error: any) {
    console.error("Error fetching stats:", error);
    throw createError({
      statusCode: error.statusCode || 500,
      message: error.message || "Failed to fetch statistics",
    });
  }
});
