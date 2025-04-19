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
        const userTimezone = userHeartbeats[userId][0]?.user.timezone || "UTC";
        await processHeartbeatsByDate(
          userId,
          userHeartbeats[userId],
          userTimezone
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
