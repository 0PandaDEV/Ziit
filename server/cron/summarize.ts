import { defineCronHandler } from "#nuxt/cron";
import { PrismaClient } from "@prisma/client";
import type { Heartbeats } from "@prisma/client";

const prisma = new PrismaClient();

export default defineCronHandler(
  "daily",
  async () => {
    try {
      const now = new Date();
      const yesterday = new Date(now);
      yesterday.setDate(yesterday.getDate() - 1);
      yesterday.setHours(0, 0, 0, 0);

      const today = new Date(now);
      today.setHours(0, 0, 0, 0);

      const heartbeatsToSummarize = await prisma.heartbeats.findMany({
        where: {
          timestamp: { lt: today },
          summariesId: null,
        },
        orderBy: {
          timestamp: "asc",
        },
      });

      const userDateHeartbeats: Record<
        string,
        Record<string, Heartbeats[]>
      > = {};

      heartbeatsToSummarize.forEach((heartbeat) => {
        const userId = heartbeat.userId;
        const date = new Date(heartbeat.timestamp);
        date.setHours(0, 0, 0, 0);
        const dateKey = date.toISOString().split("T")[0];

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

          const summary = await prisma.summaries.upsert({
            where: {
              userId_date: {
                userId,
                date: new Date(dateKey),
              },
            },
            update: {},
            create: {
              userId,
              date: new Date(dateKey),
            },
          });

          await prisma.$transaction(
            dateHeartbeats.map((heartbeat) =>
              prisma.heartbeats.update({
                where: { id: heartbeat.id },
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
