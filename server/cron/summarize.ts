import { defineCronHandler } from "#nuxt/cron";
import { PrismaClient } from "@prisma/client";
import type { Heartbeats } from "@prisma/client";

const prisma = new PrismaClient();

export default defineCronHandler(
  "daily",
  async () => {
    try {
      const now = new Date();
      now.setHours(0, 0, 0, 0);
      
      const heartbeatsToSummarize = await prisma.heartbeats.findMany({
        where: {
          timestamp: { lt: now },
          summariesId: null,
        },
        orderBy: {
          timestamp: "asc",
        },
        include: {
          user: {
            select: {
              timezone: true,
              keystrokeTimeout: true,
            },
          },
        },
      });

      const userDateHeartbeats: Record<
        string,
        Record<string, Heartbeats[]>
      > = {};

      heartbeatsToSummarize.forEach((heartbeat) => {
        const userId = heartbeat.userId;
        const userTimezone = heartbeat.user.timezone || "UTC";

        const timestamp = new Date(heartbeat.timestamp);
        const userDate = new Date(timestamp.toLocaleString("en-US", { timeZone: userTimezone }));
        const dateKey = `${userDate.getFullYear()}-${String(userDate.getMonth() + 1).padStart(2, '0')}-${String(userDate.getDate()).padStart(2, '0')}`;

        if (!userDateHeartbeats[userId]) {
          userDateHeartbeats[userId] = {};
        }

        if (!userDateHeartbeats[userId][dateKey]) {
          userDateHeartbeats[userId][dateKey] = [];
        }

        userDateHeartbeats[userId][dateKey].push(heartbeat);
      });

      for (const userId in userDateHeartbeats) {
        for (const dateKey in userDateHeartbeats[userId]) {
          const dateHeartbeats = userDateHeartbeats[userId][dateKey];

          dateHeartbeats.sort(
            (a: Heartbeats, b: Heartbeats) =>
              new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
          );

          const user = await prisma.user.findUnique({
            where: { id: userId },
            select: { keystrokeTimeout: true },
          });

          const idleThresholdMinutes = user?.keystrokeTimeout || 5;

          const totalMinutes = calculateTotalMinutesFromHeartbeats(
            dateHeartbeats,
            idleThresholdMinutes
          );

          const { projectsTime, editorsTime, languagesTime, osTime } =
            calculateCategoryTimes(dateHeartbeats, idleThresholdMinutes);

          const summary = await prisma.summaries.upsert({
            where: {
              userId_date: {
                userId,
                date: new Date(dateKey),
              },
            },
            update: {
              totalMinutes,
              projects: projectsTime,
              editors: editorsTime,
              languages: languagesTime,
              os: osTime,
            },
            create: {
              userId,
              date: new Date(dateKey),
              totalMinutes,
              projects: projectsTime,
              editors: editorsTime,
              languages: languagesTime,
              os: osTime,
            },
          });

          await prisma.$transaction(
            dateHeartbeats.map((heartbeat) =>
              prisma.heartbeats.update({
                where: {
                  id_timestamp: {
                    id: heartbeat.id,
                    timestamp: heartbeat.timestamp,
                  },
                },
                data: { summariesId: summary.id },
              })
            )
          );
        }
      }

      console.log(
        `Summarization complete. Processed ${heartbeatsToSummarize.length} heartbeats.`
      );
    } catch (error) {
      console.error("Error in summarization cron job", error);
    }
  },
  {
    timeZone: "UTC",
    runOnInit: true,
  }
);

function calculateTotalMinutesFromHeartbeats(
  heartbeats: Heartbeats[],
  idleThresholdMinutes: number
): number {
  if (heartbeats.length === 0) return 0;

  const sortedHeartbeats = [...heartbeats].sort(
    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
  );

  let totalMinutes = 0;
  let lastTimestamp: Date | null = null;
  const IDLE_THRESHOLD_MS = idleThresholdMinutes * 60 * 1000;

  for (const heartbeat of sortedHeartbeats) {
    const currentTimestamp = new Date(heartbeat.timestamp);

    if (lastTimestamp) {
      const timeDiff = currentTimestamp.getTime() - lastTimestamp.getTime();

      if (timeDiff < IDLE_THRESHOLD_MS) {
        totalMinutes += timeDiff / (60 * 1000);
      }
    }

    lastTimestamp = currentTimestamp;
  }

  return Math.round(totalMinutes);
}

function calculateCategoryTimes(
  heartbeats: Heartbeats[],
  idleThresholdMinutes: number
) {
  const projectsTime: Record<string, number> = {};
  const editorsTime: Record<string, number> = {};
  const languagesTime: Record<string, number> = {};
  const osTime: Record<string, number> = {};

  if (heartbeats.length === 0) {
    return { projectsTime, editorsTime, languagesTime, osTime };
  }

  const sortedHeartbeats = [...heartbeats].sort(
    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
  );

  let lastTimestamp: Date | null = null;
  let lastProject: string | null = null;
  let lastEditor: string | null = null;
  let lastLanguage: string | null = null;
  let lastOs: string | null = null;

  const IDLE_THRESHOLD_MS = idleThresholdMinutes * 60 * 1000;

  for (const heartbeat of sortedHeartbeats) {
    const currentTimestamp = new Date(heartbeat.timestamp);
    const currentProject = heartbeat.project || null;
    const currentEditor = heartbeat.editor || null;
    const currentLanguage = heartbeat.language || null;
    const currentOs = heartbeat.os || null;

    if (lastTimestamp) {
      const timeDiff = currentTimestamp.getTime() - lastTimestamp.getTime();

      if (timeDiff < IDLE_THRESHOLD_MS) {
        const secondsDiff = timeDiff / 1000;

        if (lastProject) {
          projectsTime[lastProject] =
            (projectsTime[lastProject] || 0) + secondsDiff;
        }

        if (lastEditor) {
          editorsTime[lastEditor] =
            (editorsTime[lastEditor] || 0) + secondsDiff;
        }

        if (lastLanguage) {
          languagesTime[lastLanguage] =
            (languagesTime[lastLanguage] || 0) + secondsDiff;
        }

        if (lastOs) {
          osTime[lastOs] = (osTime[lastOs] || 0) + secondsDiff;
        }
      }
    }

    lastTimestamp = currentTimestamp;
    lastProject = currentProject;
    lastEditor = currentEditor;
    lastLanguage = currentLanguage;
    lastOs = currentOs;
  }

  Object.keys(projectsTime).forEach((key) => {
    projectsTime[key] = Math.round(projectsTime[key]);
  });

  Object.keys(editorsTime).forEach((key) => {
    editorsTime[key] = Math.round(editorsTime[key]);
  });

  Object.keys(languagesTime).forEach((key) => {
    languagesTime[key] = Math.round(languagesTime[key]);
  });

  Object.keys(osTime).forEach((key) => {
    osTime[key] = Math.round(osTime[key]);
  });

  return { projectsTime, editorsTime, languagesTime, osTime };
}
