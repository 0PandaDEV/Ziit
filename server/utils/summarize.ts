import { PrismaClient } from "@prisma/client";
import type { Heartbeats } from "@prisma/client";

const prisma = new PrismaClient();

export function calculateTotalMinutesFromHeartbeats(
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

export function calculateCategoryTimes(
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

export async function createOrUpdateSummary(
  userId: string,
  dateStr: string,
  heartbeats: any[]
) {
  if (heartbeats.length === 0) return null;

  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { keystrokeTimeout: true },
    });

    const idleThresholdMinutes = user?.keystrokeTimeout || 5;

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const currentDate = new Date(dateStr);
    currentDate.setHours(0, 0, 0, 0);

    if (currentDate.getTime() === today.getTime()) {
      const existingHeartbeats = await prisma.heartbeats.findMany({
        where: {
          userId,
          timestamp: {
            gte: new Date(`${dateStr}T00:00:00.000Z`),
            lt: new Date(`${dateStr}T23:59:59.999Z`),
          },
        },
        select: { timestamp: true, file: true },
      });

      const existingMap = new Map();
      existingHeartbeats.forEach((h) => {
        existingMap.set(`${h.timestamp.getTime()}-${h.file || ""}`, true);
      });

      const newHeartbeats = heartbeats.filter(
        (h) =>
          !existingMap.has(`${new Date(h.timestamp).getTime()}-${h.file || ""}`)
      );

      if (newHeartbeats.length === 0) {
        return null;
      }
      const BATCH_SIZE = 1000;
      for (let i = 0; i < newHeartbeats.length; i += BATCH_SIZE) {
        const batch = newHeartbeats.slice(i, i + BATCH_SIZE);
        await prisma.heartbeats.createMany({
          data: batch,
          skipDuplicates: true,
        });
      }
      return null;
    }

    const existingHeartbeatsForImport = await prisma.heartbeats.findMany({
      where: {
        userId,
        timestamp: {
          gte: new Date(`${dateStr}T00:00:00.000Z`),
          lt: new Date(`${dateStr}T23:59:59.999Z`),
        },
      },
      select: { timestamp: true, file: true },
    });

    const existingMapForImport = new Map();
    existingHeartbeatsForImport.forEach((h) => {
      existingMapForImport.set(
        `${h.timestamp.getTime()}-${h.file || ""}`,
        true
      );
    });

    const newHeartbeatsForImport = heartbeats.filter(
      (h) =>
        !existingMapForImport.has(
          `${new Date(h.timestamp).getTime()}-${h.file || ""}`
        )
    );

    if (newHeartbeatsForImport.length > 0) {
      const BATCH_SIZE = 1000;
      for (let i = 0; i < newHeartbeatsForImport.length; i += BATCH_SIZE) {
        const batch = newHeartbeatsForImport.slice(i, i + BATCH_SIZE);
        await prisma.heartbeats.createMany({
          data: batch,
          skipDuplicates: true,
        });
      }
    }

    const allHeartbeatsForDay = await prisma.heartbeats.findMany({
      where: {
        userId,
        timestamp: {
          gte: new Date(`${dateStr}T00:00:00.000Z`),
          lt: new Date(`${dateStr}T23:59:59.999Z`),
        },
      },
      orderBy: {
        timestamp: "asc",
      },
    });

    const totalMinutes = calculateTotalMinutesFromHeartbeats(
      allHeartbeatsForDay,
      idleThresholdMinutes
    );

    const { projectsTime, editorsTime, languagesTime, osTime } =
      calculateCategoryTimes(allHeartbeatsForDay, idleThresholdMinutes);

    const summary = await prisma.summaries.upsert({
      where: {
        userId_date: {
          userId,
          date: new Date(dateStr),
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
        date: new Date(dateStr),
        totalMinutes,
        projects: projectsTime,
        editors: editorsTime,
        languages: languagesTime,
        os: osTime,
      },
    });

    if (allHeartbeatsForDay.length > 0) {
      const heartbeatsToUpdate = allHeartbeatsForDay.filter(
        (h) => h.summariesId !== summary.id
      );

      if (heartbeatsToUpdate.length > 0) {
        const BATCH_SIZE = 500;
        for (let i = 0; i < heartbeatsToUpdate.length; i += BATCH_SIZE) {
          const batch = heartbeatsToUpdate.slice(i, i + BATCH_SIZE);

          await Promise.all(
            batch.map((heartbeat) =>
              prisma.heartbeats.update({
                where: {
                  id_timestamp: {
                    id: heartbeat.id,
                    timestamp: heartbeat.timestamp,
                  },
                },
                data: {
                  summariesId: summary.id,
                },
              })
            )
          );
        }
      }
    }

    return summary;
  } catch (error) {
    console.error(`Error saving data for ${dateStr}:`, error);
    return null;
  }
}

export async function processHeartbeatsByDate(
  userId: string,
  heartbeats: any[],
  userTimezone: string
) {
  if (heartbeats.length === 0) return;

  const heartbeatsByDate = new Map<string, any[]>();

  heartbeats.forEach((heartbeat) => {
    const localDate = new Date(
      heartbeat.timestamp.toLocaleString("en-US", { timeZone: userTimezone })
    );
    const dateKey = localDate.toISOString().split("T")[0];

    if (!heartbeatsByDate.has(dateKey)) {
      heartbeatsByDate.set(dateKey, []);
    }

    heartbeatsByDate.get(dateKey)!.push(heartbeat);
  });

  for (const [dateStr, dateHeartbeats] of heartbeatsByDate.entries()) {
    await createOrUpdateSummary(userId, dateStr, dateHeartbeats);
  }
}

export async function regenerateSummariesForUser(userId: string) {
  try {
    await prisma.summaries.deleteMany({
      where: { userId },
    });

    await prisma.heartbeats.updateMany({
      where: { userId },
      data: { summariesId: null },
    });

    const heartbeats = await prisma.heartbeats.findMany({
      where: { userId },
      orderBy: { timestamp: "asc" },
    });

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { timezone: true },
    });

    const userTimezone = user?.timezone || "UTC";

    await processHeartbeatsByDate(userId, heartbeats, userTimezone);

    const summariesCount = await prisma.summaries.count({
      where: { userId },
    });

    return {
      success: true,
      message: `Regenerated ${summariesCount} summaries`,
      summariesCount,
    };
  } catch (error) {
    console.error(
      "Regenerate summaries error:",
      error instanceof Error ? error.message : "Unknown error"
    );
    throw createError({
      statusCode: 500,
      message: "Failed to regenerate summaries",
    });
  }
}
