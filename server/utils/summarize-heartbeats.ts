import { PrismaClient, Heartbeat } from "@prisma/client";

const prisma = new PrismaClient();
const HEARTBEAT_INTERVAL_SECONDS = 30;

export async function summarizeHeartbeats() {
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  yesterday.setHours(0, 0, 0, 0);

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  try {
    const heartbeats = await prisma.heartbeat.findMany({
      where: {
        timestamp: {
          gte: yesterday,
          lt: today,
        },
      },
      orderBy: {
        timestamp: "asc",
      },
    });

    const userProjectHeartbeats: Record<string, Record<string, any>> = {};

    heartbeats.forEach((heartbeat) => {
      const userId = heartbeat.userId;
      const project = heartbeat.project || "unknown";

      if (!userProjectHeartbeats[userId]) {
        userProjectHeartbeats[userId] = {};
      }

      if (!userProjectHeartbeats[userId][project]) {
        userProjectHeartbeats[userId][project] = {
          heartbeats: [],
        };
      }

      userProjectHeartbeats[userId][project].heartbeats.push(heartbeat);
    });

    for (const userId in userProjectHeartbeats) {
      for (const project in userProjectHeartbeats[userId]) {
        const projectHeartbeats =
          userProjectHeartbeats[userId][project].heartbeats;

        projectHeartbeats.sort(
          (a: Heartbeat, b: Heartbeat) =>
            new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
        );

        let totalSeconds = 0;

        for (let i = 0; i < projectHeartbeats.length; i++) {
          if (i === 0) {
            totalSeconds += HEARTBEAT_INTERVAL_SECONDS;
            continue;
          }

          const current = new Date(projectHeartbeats[i].timestamp).getTime();
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
              date: yesterday,
              project,
            },
          },
          update: {
            totalSeconds: Math.round(totalSeconds),
          },
          create: {
            userId,
            date: yesterday,
            project,
            totalSeconds: Math.round(totalSeconds),
          },
        });
      }
    }

    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const deleted = await prisma.heartbeat.deleteMany({
      where: {
        timestamp: {
          lt: thirtyDaysAgo,
        },
      },
    });

    return true;
  } catch (error) {
    console.error("Error summarizing heartbeats:", error);
    return false;
  }
}
