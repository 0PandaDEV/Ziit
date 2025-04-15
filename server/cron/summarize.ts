import { defineCronHandler } from "#nuxt/cron";
import { PrismaClient } from "@prisma/client";
import type { Heartbeats } from "@prisma/client";

const prisma = new PrismaClient();

export default defineCronHandler(
  "daily",
  async () => {
    try {
      const heartbeatsToSummarize = await prisma.heartbeats.findMany({
        where: {
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

          const user = await prisma.user.findUnique({
            where: { id: userId },
            select: { keystrokeTimeout: true },
          });

          const idleThresholdMinutes = user?.keystrokeTimeout || 5;

          const totalMinutes = calculateTotalMinutesFromHeartbeats(
            dateHeartbeats,
            idleThresholdMinutes
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
              totalMinutes,
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
