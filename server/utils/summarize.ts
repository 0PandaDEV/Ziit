import { PrismaClient } from "@prisma/client";
import type { Heartbeats, Summaries } from "@prisma/client";

const prisma = new PrismaClient({
  log: ["warn", "error"],
});

export function calculateTotalMinutesFromHeartbeats(
  heartbeats: Heartbeats[],
  idleThresholdMinutes: number,
): number {
  if (heartbeats.length === 0) return 0;

  const sortedHeartbeats = [...heartbeats].sort(
    (a, b) => Number(a.timestamp) - Number(b.timestamp),
  );

  let totalMinutes = 0;
  let lastTimestamp: number | null = null;
  const IDLE_THRESHOLD_MS = idleThresholdMinutes * 60 * 1000;

  for (const heartbeat of sortedHeartbeats) {
    const currentTimestamp = Number(heartbeat.timestamp);

    if (lastTimestamp) {
      const timeDiff = currentTimestamp - lastTimestamp;

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
  idleThresholdMinutes: number,
) {
  const projectsTime: Record<string, number> = {};
  const editorsTime: Record<string, number> = {};
  const languagesTime: Record<string, number> = {};
  const osTime: Record<string, number> = {};
  const filesTime: Record<string, number> = {};
  const branchesTime: Record<string, number> = {};

  if (heartbeats.length === 0) {
    return {
      projectsTime,
      editorsTime,
      languagesTime,
      osTime,
      filesTime,
      branchesTime,
    };
  }

  const sortedHeartbeats = [...heartbeats].sort(
    (a, b) => Number(a.timestamp) - Number(b.timestamp),
  );

  let lastTimestamp: number | null = null;
  let lastProject: string | null = null;
  let lastEditor: string | null = null;
  let lastLanguage: string | null = null;
  let lastOs: string | null = null;
  let lastFile: string | null = null;
  let lastBranch: string | null = null;

  const IDLE_THRESHOLD_MS = idleThresholdMinutes * 60 * 1000;

  for (const heartbeat of sortedHeartbeats) {
    const currentTimestamp = Number(heartbeat.timestamp);
    const currentProject = heartbeat.project || null;
    const currentEditor = heartbeat.editor || null;
    const currentLanguage = heartbeat.language || null;
    const currentOs = heartbeat.os || null;
    const currentFile = heartbeat.file || null;
    const currentBranch = heartbeat.branch || null;

    if (lastTimestamp) {
      const timeDiff = currentTimestamp - lastTimestamp;

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

        if (lastFile) {
          filesTime[lastFile] = (filesTime[lastFile] || 0) + secondsDiff;
        }

        if (lastBranch) {
          branchesTime[lastBranch] =
            (branchesTime[lastBranch] || 0) + secondsDiff;
        }
      }
    }

    lastTimestamp = currentTimestamp;
    lastProject = currentProject;
    lastEditor = currentEditor;
    lastLanguage = currentLanguage;
    lastOs = currentOs;
    lastFile = currentFile;
    lastBranch = currentBranch;
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

  Object.keys(filesTime).forEach((key) => {
    filesTime[key] = Math.round(filesTime[key]);
  });

  Object.keys(branchesTime).forEach((key) => {
    branchesTime[key] = Math.round(branchesTime[key]);
  });

  return {
    projectsTime,
    editorsTime,
    languagesTime,
    osTime,
    filesTime,
    branchesTime,
  };
}

export async function createOrUpdateSummary(
  userId: string,
  dateStr: string,
  heartbeats: any[],
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
      const startOfDay = new Date(dateStr);
      startOfDay.setHours(0, 0, 0, 0);
      const endOfDay = new Date(dateStr);
      endOfDay.setHours(23, 59, 59, 999);

      const startTimestamp = BigInt(startOfDay.getTime());
      const endTimestamp = BigInt(endOfDay.getTime());

      const existingHeartbeats = await prisma.heartbeats.findMany({
        where: {
          userId,
          timestamp: {
            gte: startTimestamp,
            lte: endTimestamp,
          },
        },
        select: { timestamp: true, file: true },
      });

      const existingMap = new Map();
      existingHeartbeats.forEach((h) => {
        existingMap.set(`${h.timestamp}-${h.file || ""}`, true);
      });

      const newHeartbeats = heartbeats.filter(
        (h) => !existingMap.has(`${h.timestamp}-${h.file || ""}`),
      );

      if (newHeartbeats.length === 0) {
        return null;
      }

      const BATCH_SIZE = 2000;
      for (let i = 0; i < newHeartbeats.length; i += BATCH_SIZE) {
        const batch = newHeartbeats.slice(i, i + BATCH_SIZE);
        await prisma.heartbeats.createMany({
          data: batch.map((h) => ({
            userId: h.userId,
            timestamp: h.timestamp,
            project: h.project,
            language: h.language,
            editor: h.editor,
            os: h.os,
            branch: h.branch,
            file: h.file,
          })),
          skipDuplicates: true,
        });
      }
      return null;
    }

    const startOfDay = new Date(dateStr);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(dateStr);
    endOfDay.setHours(23, 59, 59, 999);

    const startTimestamp = BigInt(startOfDay.getTime());
    const endTimestamp = BigInt(endOfDay.getTime());

    const existingHeartbeatsForImport = await prisma.$queryRaw<
      Array<{ timestamp: bigint; file: string | null }>
    >`
      SELECT timestamp, file
      FROM "Heartbeats"
      WHERE "userId" = ${userId}
        AND timestamp >= ${startTimestamp.toString()}::bigint
        AND timestamp <= ${endTimestamp.toString()}::bigint
    `;

    const existingMapForImport = new Map();
    existingHeartbeatsForImport.forEach((h) => {
      existingMapForImport.set(`${h.timestamp}-${h.file || ""}`, true);
    });

    const newHeartbeatsForImport = heartbeats.filter(
      (h) => !existingMapForImport.has(`${h.timestamp}-${h.file || ""}`),
    );

    if (newHeartbeatsForImport.length > 0) {
      const BATCH_SIZE = 2000;
      for (let i = 0; i < newHeartbeatsForImport.length; i += BATCH_SIZE) {
        const batch = newHeartbeatsForImport.slice(i, i + BATCH_SIZE);

        await prisma.heartbeats.createMany({
          data: batch.map((h) => ({
            userId: h.userId,
            timestamp: h.timestamp,
            project: h.project,
            language: h.language,
            editor: h.editor,
            os: h.os,
            branch: h.branch,
            file: h.file,
          })),
          skipDuplicates: true,
        });
      }
    }

    const allHeartbeatsForDay = await prisma.$queryRaw<
      Array<{
        id: string;
        timestamp: bigint;
        userId: string;
        project: string | null;
        language: string | null;
        editor: string | null;
        os: string | null;
        file: string | null;
        branch: string | null;
        createdAt: Date;
        summariesId: string | null;
      }>
    >`
      SELECT id, timestamp, "userId", project, language, editor, os, file, branch, "createdAt", "summariesId"
      FROM "Heartbeats"
      WHERE "userId" = ${userId}
        AND timestamp >= ${startTimestamp.toString()}::bigint
        AND timestamp <= ${endTimestamp.toString()}::bigint
      ORDER BY timestamp ASC
    `;

    const totalMinutes = calculateTotalMinutesFromHeartbeats(
      allHeartbeatsForDay,
      idleThresholdMinutes,
    );

    const {
      projectsTime,
      editorsTime,
      languagesTime,
      osTime,
      filesTime,
      branchesTime,
    } = calculateCategoryTimes(allHeartbeatsForDay, idleThresholdMinutes);

    const existingSummary = await prisma.summaries.findFirst({
      where: {
        userId,
        date: new Date(dateStr),
      },
    });

    let summary: Summaries;
    if (existingSummary) {
      summary = await prisma.summaries.update({
        where: {
          id_date: {
            id: existingSummary.id,
            date: existingSummary.date,
          },
        },
        data: {
          totalMinutes,
          projects: projectsTime,
          editors: editorsTime,
          languages: languagesTime,
          os: osTime,
          files: filesTime,
          branches: branchesTime,
        },
      });
    } else {
      summary = await prisma.summaries.create({
        data: {
          userId,
          date: new Date(dateStr),
          totalMinutes,
          projects: projectsTime,
          editors: editorsTime,
          languages: languagesTime,
          os: osTime,
          files: filesTime,
          branches: branchesTime,
        },
      });
    }

    if (allHeartbeatsForDay.length > 0) {
      const heartbeatsToUpdate = allHeartbeatsForDay.filter(
        (h) => h.summariesId !== summary.id,
      );

      if (heartbeatsToUpdate.length > 0) {
        await prisma.$executeRaw`
          UPDATE "Heartbeats"
          SET "summariesId" = ${summary.id}
          WHERE "userId" = ${userId}
            AND timestamp >= ${startTimestamp.toString()}::bigint
            AND timestamp <= ${endTimestamp.toString()}::bigint
            AND "summariesId" IS NULL
        `;
      }
    }

    return summary;
  } catch (error) {
    console.error(`Error saving data for ${dateStr}:`, error);
    return null;
  }
}

export async function createOrUpdateSummaryForCron(
  userId: string,
  dateStr: string,
  heartbeats: Heartbeats[],
) {
  if (heartbeats.length === 0) return null;

  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { keystrokeTimeout: true },
    });

    const idleThresholdMinutes = user?.keystrokeTimeout || 5;

    const startOfDay = new Date(dateStr);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(dateStr);
    endOfDay.setHours(23, 59, 59, 999);

    const totalMinutes = calculateTotalMinutesFromHeartbeats(
      heartbeats,
      idleThresholdMinutes,
    );

    const {
      projectsTime,
      editorsTime,
      languagesTime,
      osTime,
      filesTime,
      branchesTime,
    } = calculateCategoryTimes(heartbeats, idleThresholdMinutes);

    const existingSummary = await prisma.summaries.findFirst({
      where: {
        userId,
        date: new Date(dateStr),
      },
    });

    let summary: Summaries;
    if (existingSummary) {
      summary = await prisma.summaries.update({
        where: {
          id_date: {
            id: existingSummary.id,
            date: existingSummary.date,
          },
        },
        data: {
          totalMinutes,
          projects: projectsTime,
          editors: editorsTime,
          languages: languagesTime,
          os: osTime,
          files: filesTime,
          branches: branchesTime,
        },
      });
    } else {
      summary = await prisma.summaries.create({
        data: {
          userId,
          date: new Date(dateStr),
          totalMinutes,
          projects: projectsTime,
          editors: editorsTime,
          languages: languagesTime,
          os: osTime,
          files: filesTime,
          branches: branchesTime,
        },
      });
    }

    if (heartbeats.length > 0) {
      const heartbeatsToUpdate = heartbeats.filter(
        (h) => h.summariesId !== summary.id,
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
              }),
            ),
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
) {
  if (heartbeats.length === 0) return;

  const heartbeatsByDate = new Map<string, any[]>();

  heartbeats.forEach((heartbeat) => {
    const date = new Date(Number(heartbeat.timestamp));
    const dateKey = date.toISOString().split("T")[0];

    if (!heartbeatsByDate.has(dateKey)) {
      heartbeatsByDate.set(dateKey, []);
    }

    heartbeatsByDate.get(dateKey)!.push(heartbeat);
  });

  for (const [dateStr, dateHeartbeats] of heartbeatsByDate.entries()) {
    await createOrUpdateSummary(userId, dateStr, dateHeartbeats);
  }
}

export async function processSummariesByDate(
  userId: string,
  heartbeats: Heartbeats[],
) {
  if (heartbeats.length === 0) return;

  const heartbeatsByDate = new Map<string, Heartbeats[]>();

  heartbeats.forEach((heartbeat) => {
    const date = new Date(Number(heartbeat.timestamp));
    const dateKey = date.toISOString().split("T")[0];

    if (!heartbeatsByDate.has(dateKey)) {
      heartbeatsByDate.set(dateKey, []);
    }

    heartbeatsByDate.get(dateKey)!.push(heartbeat);
  });

  for (const [dateStr, dateHeartbeats] of heartbeatsByDate.entries()) {
    await createOrUpdateSummaryForCron(userId, dateStr, dateHeartbeats);
  }
}

export async function regenerateSummariesForUser(userId: string) {
  try {
    await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`
        DELETE FROM "Summaries"
        WHERE "userId" = ${userId}
      `;

      await tx.$executeRaw`
        UPDATE "Heartbeats"
        SET "summariesId" = NULL
        WHERE "userId" = ${userId}
      `;
    });

    const heartbeatsData = await prisma.$queryRaw<
      Array<{
        id: string;
        timestamp: bigint;
        userId: string;
        project: string | null;
        language: string | null;
        editor: string | null;
        os: string | null;
        file: string | null;
        branch: string | null;
        createdAt: Date;
        summariesId: string | null;
      }>
    >`
      SELECT id, timestamp, "userId", project, language, editor, os, file, branch, "createdAt", "summariesId"
      FROM "Heartbeats"
      WHERE "userId" = ${userId}
      ORDER BY timestamp ASC
    `;

    const heartbeats = heartbeatsData;

    await processHeartbeatsByDate(userId, heartbeats);

    const summariesCountResult = await prisma.$queryRaw<
      Array<{ count: string }>
    >`
      SELECT COUNT(*) as count
      FROM "Summaries"
      WHERE "userId" = ${userId}
    `;

    const summariesCount = parseInt(summariesCountResult[0].count);

    return {
      success: true,
      message: `Regenerated ${summariesCount} summaries`,
      summariesCount,
    };
  } catch (error) {
    console.error(
      "Regenerate summaries error:",
      error instanceof Error ? error.message : "Unknown error",
    );
    throw createError({
      statusCode: 69,
      message: "Failed to regenerate summaries",
    });
  }
}
