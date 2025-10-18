import { defineCronHandler } from "#nuxt/cron";
import { PrismaClient } from "@prisma/client";
import { processSummariesByDate } from "~~/server/utils/summarize";
import { handleLog } from "../utils/logging";

const prisma = new PrismaClient({
  log: ["warn", "error"],
});

export default defineCronHandler(
  "daily",
  async () => {
    try {
      const now = new Date();
      now.setHours(0, 0, 0, 0);
      const nowTimestamp = BigInt(now.getTime());

      const BATCH_SIZE = 5000;
      let processedCount = 0;
      let hasMore = true;

      while (hasMore) {
        const heartbeatsToSummarize = await prisma.$queryRaw<
          Array<{
            id: string;
            timestamp: bigint;
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
          WHERE h.timestamp < ${nowTimestamp.toString()}::bigint
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
        `Summarization complete. Processed ${processedCount} heartbeats.`,
      );
    } catch (error) {
      console.error("Error in summarization cron job", error);
    }
  },
  {
    timeZone: "UTC",
    runOnInit: true,
  },
);

async function generatePublicStats(date: Date) {
  try {
    const statsDate = new Date(date);
    statsDate.setHours(0, 0, 0, 0);

    const existingStats = await prisma.$queryRaw<Array<{ count: string }>>`
      SELECT COUNT(*) as count
      FROM "Stats"
      WHERE date = ${statsDate}::date
    `;

    if (parseInt(existingStats[0].count) > 0) {
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
      prisma.$queryRaw<Array<{ count: string }>>`
        SELECT COUNT(*) as count FROM "User"
      `,

      prisma.$queryRaw<Array<{ count: string }>>`
        SELECT COUNT(*) as count FROM "Heartbeats"
      `,

      prisma.$queryRaw<Array<{ total_minutes: string }>>`
        SELECT COALESCE(SUM("totalMinutes"), 0) as total_minutes
        FROM "Summaries"
      `,

      prisma.$queryRaw<Array<{ editor: string; count: string }>>`
        SELECT editor, COUNT(*) as count
        FROM "Heartbeats"
        WHERE editor IS NOT NULL
        GROUP BY editor
        ORDER BY COUNT(*) DESC
        LIMIT 1
      `,

      prisma.$queryRaw<Array<{ language: string; count: string }>>`
        SELECT language, COUNT(*) as count
        FROM "Heartbeats"
        WHERE language IS NOT NULL
        GROUP BY language
        ORDER BY COUNT(*) DESC
        LIMIT 1
      `,

      prisma.$queryRaw<Array<{ os: string; count: string }>>`
        SELECT os, COUNT(*) as count
        FROM "Heartbeats"
        WHERE os IS NOT NULL
        GROUP BY os
        ORDER BY COUNT(*) DESC
        LIMIT 1
      `,
    ]);

    const totalUsers = parseInt(userCountResult[0].count);
    const totalHeartbeats = parseInt(heartbeatCountResult[0].count);
    const totalHours = Math.floor(
      parseInt(summariesAggregateResult[0].total_minutes) / 60,
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
      `Generated public stats for ${statsDate.toISOString().split("T")[0]}: ${totalUsers} users, ${totalHeartbeats} heartbeats, ${totalHours} hours`,
    );
  } catch (error) {
    console.error("Error generating public stats:", error);
  }
}
