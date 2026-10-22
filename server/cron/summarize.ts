import { defineCronHandler } from "#nuxt/cron";

import { summarizePendingDays } from "~~/server/utils/summarize";
import { handleLog } from "../utils/logging";
import { prisma } from "~~/prisma/db";
import {
  normalizeEditor,
  normalizeLanguage,
  normalizeOs,
} from "~~/server/utils/normalize";

export default defineCronHandler(
  "daily",
  async () => {
    try {
      const processedCount = await summarizePendingDays();

      const now = new Date();
      now.setUTCHours(0, 0, 0, 0);
      await generatePublicStats(now);

      handleLog(`Summarization complete. Processed ${processedCount} days.`);
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

      prisma.$queryRaw<Array<{ total: bigint }>>`
        SELECT COALESCE(SUM(heartbeat_count), 0)::bigint AS total
        FROM heartbeats_daily
      `,

      prisma.summaries.aggregate({
        _sum: {
          totalMinutes: true,
        },
      }),

      prisma.$queryRaw<Array<{ name: string }>>`
        SELECT editor AS name
        FROM heartbeats_daily
        WHERE editor IS NOT NULL
        GROUP BY editor
        ORDER BY SUM(heartbeat_count) DESC
        LIMIT 1
      `,

      prisma.$queryRaw<Array<{ name: string }>>`
        SELECT language AS name
        FROM heartbeats_daily
        WHERE language IS NOT NULL
        GROUP BY language
        ORDER BY SUM(heartbeat_count) DESC
        LIMIT 1
      `,

      prisma.$queryRaw<Array<{ name: string }>>`
        SELECT os AS name
        FROM heartbeats_daily
        WHERE os IS NOT NULL
        GROUP BY os
        ORDER BY SUM(heartbeat_count) DESC
        LIMIT 1
      `,
    ]);

    const totalUsers = userCountResult;
    const totalHeartbeats = Number(heartbeatCountResult[0]?.total ?? 0);
    const totalHours = Math.floor(
      (summariesAggregateResult._sum.totalMinutes || 0) / 60
    );

    const topEditor = normalizeEditor(topEditorResult[0]?.name) || "Unknown";
    const topLanguage =
      normalizeLanguage(topLanguageResult[0]?.name) || "Unknown";
    const topOS = normalizeOs(topOSResult[0]?.name) || "Unknown";

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
