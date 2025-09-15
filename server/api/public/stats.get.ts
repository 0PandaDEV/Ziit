import { PrismaClient } from "@prisma/client";
import { handleApiError } from "~~/server/utils/logging";

defineRouteMeta({
  openAPI: {
    tags: ["Public", "Stats"],
    summary: "Get public platform stats",
    description: "Returns aggregate statistics across the platform.",
    responses: {
      200: { description: "Public stats payload" },
      500: { description: "Failed to fetch stats" },
    },
    operationId: "getPublicStats",
  },
});

const prisma = new PrismaClient();

export default defineEventHandler(async (event) => {
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

    setResponseHeaders(event, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET",
    });

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
      69,
      `Failed to fetch public stats: ${detailedMessage}`,
      "Failed to fetch stats"
    );
  }
});
