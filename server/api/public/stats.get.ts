import { PrismaClient } from "@prisma/client";
import { handleApiError } from "~/server/utils/logging";

const prisma = new PrismaClient();

export default defineEventHandler(async () => {
  try {
    const latestStats = await prisma.stats.findFirst({
      orderBy: {
        date: "desc",
      },
    });

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

    const topEditor = latestStats?.topEditor || "Unknown";
    const topLanguage = latestStats?.topLanguage || "Unknown";
    const topOS = latestStats?.topOS || "Unknown";

    return {
      totalUsers,
      totalHeartbeats,
      totalHours,
      topEditor,
      topLanguage,
      topOS,
      lastUpdated: latestStats?.createdAt || new Date(),
      source: latestStats ? "mixed" : "live",
    };
  } catch (error: any) {
    if (error && typeof error === "object" && error.statusCode) throw error;
    const detailedMessage =
      error instanceof Error
        ? error.message
        : "An unknown error occurred fetching stats";
    throw handleApiError(
      500,
      `Failed to fetch public stats: ${detailedMessage}`,
      "Failed to fetch stats"
    );
  }
});
