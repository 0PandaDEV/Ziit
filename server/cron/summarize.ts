import { defineCronHandler } from "#nuxt/cron";
import { PrismaClient } from "@prisma/client";
import { processHeartbeatsByDate } from "~/server/utils/summarize";

const prisma = new PrismaClient();

export default defineCronHandler(
  "daily",
  async () => {
    try {
      const now = new Date();
      now.setHours(0, 0, 0, 0);
      const nowTimestamp = BigInt(now.getTime());

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
      });

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
        await processHeartbeatsByDate(
          userId,
          userHeartbeats[userId]
        );
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
