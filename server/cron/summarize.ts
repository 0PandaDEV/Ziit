import { defineCronHandler } from "#nuxt/cron";
import { PrismaClient, Heartbeat } from "@prisma/client";

const prisma = new PrismaClient();
const HEARTBEAT_INTERVAL_SECONDS = 30;

export default defineCronHandler(
  "daily",
  async () => {
    try {
      const now = new Date();
      const randomOffset = Math.floor(Math.random() * 24 * 60 * 60 * 1000);
      const yesterday = new Date(now.getTime() - randomOffset);
      yesterday.setHours(0, 0, 0, 0);

      const today = new Date(now.getTime() - randomOffset + 24 * 60 * 60 * 1000);
      today.setHours(0, 0, 0, 0);

      const heartbeatsToSummarize = await prisma.heartbeat.findMany({
        where: {
          AND: [
            { timestamp: { lt: yesterday } },
            {
              NOT: {
                AND: [
                  {
                    userId: {
                      in: await prisma.dailyProjectSummary
                        .findMany({ select: { userId: true } })
                        .then((s) => s.map((x) => x.userId)),
                    },
                  },
                  {
                    project: {
                      in: await prisma.dailyProjectSummary
                        .findMany({ select: { project: true } })
                        .then((s) => s.map((x) => x.project)),
                    },
                  },
                ],
              },
            },
          ],
        },
        orderBy: {
          timestamp: "asc",
        },
      });

      const userProjectHeartbeats: Record<string, Record<string, any>> = {};

      heartbeatsToSummarize.forEach((heartbeat) => {
        const userId = heartbeat.userId;
        const project = heartbeat.project || "unknown";
        const date = new Date(heartbeat.timestamp);
        date.setHours(0, 0, 0, 0);
        const dateKey = date.toISOString().split("T")[0];

        if (!userProjectHeartbeats[userId]) {
          userProjectHeartbeats[userId] = {};
        }

        if (!userProjectHeartbeats[userId][dateKey]) {
          userProjectHeartbeats[userId][dateKey] = {};
        }

        if (!userProjectHeartbeats[userId][dateKey][project]) {
          userProjectHeartbeats[userId][dateKey][project] = {
            heartbeats: [],
          };
        }

        userProjectHeartbeats[userId][dateKey][project].heartbeats.push(
          heartbeat
        );
      });

      for (const userId in userProjectHeartbeats) {
        for (const dateKey in userProjectHeartbeats[userId]) {
          for (const project in userProjectHeartbeats[userId][dateKey]) {
            const projectHeartbeats =
              userProjectHeartbeats[userId][dateKey][project].heartbeats;

            projectHeartbeats.sort(
              (a: Heartbeat, b: Heartbeat) =>
                new Date(a.timestamp).getTime() -
                new Date(b.timestamp).getTime()
            );

            let totalSeconds = 0;

            for (let i = 0; i < projectHeartbeats.length; i++) {
              if (i === 0) {
                totalSeconds += HEARTBEAT_INTERVAL_SECONDS;
                continue;
              }

              const current = new Date(
                projectHeartbeats[i].timestamp
              ).getTime();
              const previous = new Date(
                projectHeartbeats[i - 1].timestamp
              ).getTime();
              const diff = (current - previous) / 1000;

              if (diff < 300) {
                totalSeconds += diff;
              } else {
                totalSeconds += HEARTBEAT_INTERVAL_SECONDS;
              }
            }

            await prisma.dailyProjectSummary.upsert({
              where: {
                userId_date_project: {
                  userId,
                  date: new Date(dateKey),
                  project,
                },
              },
              update: {
                totalSeconds: Math.round(totalSeconds),
              },
              create: {
                userId,
                date: new Date(dateKey),
                project,
                totalSeconds: Math.round(totalSeconds),
              },
            });
          }
        }
      }

      const sixMonthsAgo = new Date();
      sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);

      await prisma.heartbeat.deleteMany({
        where: {
          timestamp: {
            lt: sixMonthsAgo,
          },
        },
      });
    } catch (error) {
      console.error("Error in summarization cron job:", error);
    }
  },
  {
    timeZone: "UTC",
    runOnInit: true,
  }
);
