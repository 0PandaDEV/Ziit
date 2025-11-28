import { defineCronHandler } from "#nuxt/cron";

import { processSummariesByDate } from "~~/server/utils/summarize";
import { handleLog } from "../utils/logging";
import { prisma } from "~~/prisma/prisma";

export default defineCronHandler(
  "daily",
  async () => {
    try {
      const now = new Date();
      now.setHours(0, 0, 0, 0);

      const BATCH_SIZE = 5000;
      let processedCount = 0;
      let hasMore = true;

      while (hasMore) {
        const heartbeatsToSummarize = await prisma.$queryRaw<
          Array<{
            id: string;
            timestamp: Date;
            userId: string;
            project: string | null;
            editor: string | null;
            language: string | null;
            os: string | null;
            file: string | null;
            branch: string | null;
            createdAt: Date;
            summariesId: string | null;
            keystrokeTimeout: number;
          }>
        >`
          SELECT DISTINCT ON (h."userId", h.timestamp, h.id)
            h.id,
            h.timestamp,
            h."userId",
            h.project,
            h.editor,
            h.language,
            h.os,
            h.file,
            h.branch,
            h."createdAt",
            h."summariesId",
            u."keystrokeTimeout"
          FROM "Heartbeats" h
          INNER JOIN "User" u ON h."userId" = u.id
          WHERE h.timestamp < ${now}::timestamptz
            AND h."summariesId" IS NULL
          ORDER BY h."userId", h.timestamp ASC, h.id
          LIMIT ${BATCH_SIZE}
        `;

        if (heartbeatsToSummarize.length === 0) {
          hasMore = false;
          break;
        }

        processedCount += heartbeatsToSummarize.length;

        const userHeartbeats: Record<
          string,
          Array<(typeof heartbeatsToSummarize)[0]>
        > = {};

        heartbeatsToSummarize.forEach((heartbeat) => {
          const userId = heartbeat.userId;

          if (!userHeartbeats[userId]) {
            userHeartbeats[userId] = [];
          }

          userHeartbeats[userId].push(heartbeat);
        });

        for (const userId in userHeartbeats) {
          await processSummariesByDate(userId, userHeartbeats[userId]);
        }

        if (heartbeatsToSummarize.length < BATCH_SIZE) {
          hasMore = false;
        }
      }

      await generatePublicStats(now);

      handleLog(
        `Summarization complete. Processed ${processedCount} heartbeats.`
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

async function generatePublicStats(date: Date) {
  try {
    const statsDate = new Date(date);
    statsDate.setHours(0, 0, 0, 0);

    const existingStats = await prisma.stats.count({
      where: {
        date: statsDate,
      },
    });

    if (existingStats > 0) {
      return;
    }

    const [
      userCountResult,
      heartbeatCountResult,
      summariesAggregateResult,
      topEditorResult,
      topLanguageResult,
      topOSResult,
    ] = await Promise.all([
      prisma.user.count(),

      prisma.heartbeats.count(),

      prisma.summaries.aggregate({
        _sum: {
          totalMinutes: true,
        },
      }),

      prisma.heartbeats.groupBy({
        by: ["editor"],
        where: {
          editor: { not: null },
        },
        _count: {
          _all: true,
        },
        orderBy: {
          _count: {
            editor: "desc",
          },
        },
        take: 1,
      }),

      prisma.heartbeats.groupBy({
        by: ["language"],
        where: {
          language: { not: null },
        },
        _count: {
          _all: true,
        },
        orderBy: {
          _count: {
            language: "desc",
          },
        },
        take: 1,
      }),

      prisma.heartbeats.groupBy({
        by: ["os"],
        where: {
          os: { not: null },
        },
        _count: {
          _all: true,
        },
        orderBy: {
          _count: {
            os: "desc",
          },
        },
        take: 1,
      }),
    ]);

    const totalUsers = userCountResult;
    const totalHeartbeats = heartbeatCountResult;
    const totalHours = Math.floor(
      (summariesAggregateResult._sum.totalMinutes || 0) / 60
    );

    const topEditor = topEditorResult[0]?.editor || "Unknown";
    const topLanguage = topLanguageResult[0]?.language || "Unknown";
    const topOS = topOSResult[0]?.os || "Unknown";

    await prisma.stats.create({
      data: {
        date: statsDate,
        totalHours,
        totalUsers: BigInt(totalUsers),
        totalHeartbeats,
        topEditor,
        topLanguage,
        topOS,
      },
    });

    handleLog(
      `Generated public stats for ${statsDate.toISOString().split("T")[0]}: ${totalUsers} users, ${totalHeartbeats} heartbeats, ${totalHours} hours`
    );
  } catch (error) {
    console.error("Error generating public stats:", error);
  }
}
