import { prisma } from "~~/prisma/db";
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

export default defineCachedEventHandler(
  async () => {
    try {
      const latestStats = await prisma.stats.findFirst({
        orderBy: { date: "desc" },
      });

      let totalUsers: number;
      let totalHeartbeats: number;
      let totalHours: number;

      const now = new Date();
      const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

      if (latestStats && latestStats.date >= oneDayAgo) {
        totalUsers = Number(latestStats.totalUsers);
        totalHeartbeats = latestStats.totalHeartbeats;
        totalHours = latestStats.totalHours;

        const [newUsersCount, newHeartbeatsResult, newSummariesAggregate] =
          await Promise.all([
            prisma.user.count({
              where: { createdAt: { gt: latestStats.date } },
            }),
            prisma.$queryRaw`
          SELECT COUNT(*) as count
          FROM "Heartbeats"
          WHERE "createdAt" > ${latestStats.date}
        ` as Promise<[{ count: string }]>,
            prisma.summaries.aggregate({
              _sum: { totalMinutes: true },
              where: { createdAt: { gt: latestStats.date } },
            }),
          ]);

        totalUsers += newUsersCount;
        totalHeartbeats += Number(newHeartbeatsResult[0]?.count || 0);
        totalHours += Math.floor(
          Number(newSummariesAggregate._sum.totalMinutes || 0) / 60
        );
      } else {
        const [usersCount, heartbeatsResult, summariesAggregate] =
          await Promise.all([
            prisma.user.count(),
            prisma.$queryRaw`SELECT COUNT(*) as count FROM "Heartbeats"` as Promise<
              [{ count: string }]
            >,
            prisma.summaries.aggregate({ _sum: { totalMinutes: true } }),
          ]);

        totalUsers = usersCount;
        totalHeartbeats = Number(heartbeatsResult[0]?.count || 0);
        totalHours = Math.floor(
          Number(summariesAggregate._sum.totalMinutes || 0) / 60
        );
      }

      const topEditor = latestStats?.topEditor || "Unknown";
      const topLanguage = latestStats?.topLanguage || "Unknown";
      const topOS = latestStats?.topOS || "Unknown";

      const result = {
        totalUsers,
        totalHeartbeats,
        totalHours,
        topEditor,
        topLanguage,
        topOS,
        lastUpdated: latestStats?.createdAt || new Date(),
        source: latestStats ? "mixed" : "live",
      };

      return result;
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
  },
  { maxAge: 5 * 60 }
);
