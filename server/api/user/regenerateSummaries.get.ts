import { PrismaClient } from "@prisma/client";
import { H3Event } from "h3";
import type { Heartbeats } from "@prisma/client";

const prisma = new PrismaClient();

export default defineEventHandler(async (event: H3Event) => {
  try {
    const userId = event.context.user.id;

    await prisma.summaries.deleteMany({
      where: {
        userId,
      },
    });

    await prisma.heartbeats.updateMany({
      where: {
        userId,
      },
      data: {
        summariesId: null,
      },
    });

    const heartbeats = await prisma.heartbeats.findMany({
      where: {
        userId,
      },
      orderBy: {
        timestamp: "asc",
      },
    });

    const dateHeartbeats: Record<string, Heartbeats[]> = {};

    heartbeats.forEach((heartbeat) => {
      const date = new Date(heartbeat.timestamp);
      date.setHours(0, 0, 0, 0);
      const dateKey = date.toISOString().split("T")[0];

      if (!dateHeartbeats[dateKey]) {
        dateHeartbeats[dateKey] = [];
      }

      dateHeartbeats[dateKey].push(heartbeat);
    });

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { keystrokeTimeout: true },
    });

    const idleThresholdMinutes = user?.keystrokeTimeout || 5;

    const summaries = [];
    for (const dateKey in dateHeartbeats) {
      const dayHeartbeats = dateHeartbeats[dateKey];

      dayHeartbeats.sort(
        (a, b) =>
          new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
      );

      const totalMinutes = calculateTotalMinutesFromHeartbeats(
        dayHeartbeats,
        idleThresholdMinutes,
      );

      const summary = await prisma.summaries.create({
        data: {
          userId,
          date: new Date(dateKey),
          totalMinutes,
        },
      });

      await prisma.$transaction(
        dayHeartbeats.map((heartbeat) =>
          prisma.heartbeats.update({
            where: { id: heartbeat.id },
            data: { summariesId: summary.id },
          }),
        ),
      );

      summaries.push(summary);
    }

    return {
      success: true,
      message: `Regenerated ${summaries.length} summaries`,
      summariesCount: summaries.length,
    };
  } catch (error) {
    console.error(
      "Regenerate summaries error:",
      error instanceof Error ? error.message : "Unknown error",
    );
    throw createError({
      statusCode: 500,
      message: "Failed to regenerate summaries",
    });
  }
});

function calculateTotalMinutesFromHeartbeats(
  heartbeats: Heartbeats[],
  idleThresholdMinutes: number,
): number {
  if (heartbeats.length === 0) return 0;

  const sortedHeartbeats = [...heartbeats].sort(
    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
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
