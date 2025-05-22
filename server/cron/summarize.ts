import { defineCronHandler } from "#nuxt/cron";
import { PrismaClient } from "@prisma/client";
import { processSummariesByDate } from "~/server/utils/summarize";
import { log } from "../utils/logging";

const prisma = new PrismaClient({
  log: ['warn', 'error'],
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
        const heartbeatsToSummarize = await prisma.heartbeats.findMany({
          where: {
            timestamp: { lt: nowTimestamp },
            summariesId: null,
          },
          orderBy: {
            timestamp: "asc",
          },
          include: {
            user: {
              select: {
                keystrokeTimeout: true,
              },
            },
          },
          take: BATCH_SIZE,
        });
        
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

      log(
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

    const existingStats = await prisma.stats.findUnique({
      where: { date: statsDate },
    });

    if (existingStats) {
      return;
    }

    const totalUsers = await prisma.user.count();
    const totalHeartbeats = await prisma.heartbeats.count();

    const summariesAggregate = await prisma.summaries.aggregate({
      _sum: {
        totalMinutes: true,
      },
    });

    const totalHours = Math.floor(
      Number(summariesAggregate._sum.totalMinutes || 0) / 60
    );

    const topEditorResult = await prisma.heartbeats.groupBy({
      by: ["editor"],
      _count: {
        editor: true,
      },
      where: {
        editor: {
          not: null,
        },
      },
      orderBy: {
        _count: {
          editor: "desc",
        },
      },
      take: 1,
    });

    const topLanguageResult = await prisma.heartbeats.groupBy({
      by: ["language"],
      _count: {
        language: true,
      },
      where: {
        language: {
          not: null,
        },
      },
      orderBy: {
        _count: {
          language: "desc",
        },
      },
      take: 1,
    });

    const topOSResult = await prisma.heartbeats.groupBy({
      by: ["os"],
      _count: {
        os: true,
      },
      where: {
        os: {
          not: null,
        },
      },
      orderBy: {
        _count: {
          os: "desc",
        },
      },
      take: 1,
    });

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

    log(
      `Generated public stats for ${statsDate.toISOString().split("T")[0]}`
    );
  } catch (error) {
    console.error("Error generating public stats:", error);
  }
}
