import { prisma } from "~~/prisma/prisma";

defineRouteMeta({
  openAPI: {
    tags: ["Public", "Leaderboard"],
    summary: "Get public leaderboard",
    description:
      "Returns leaderboard with user rankings based on total coding time.",
    responses: {
      200: { description: "Leaderboard data with user rankings" },
      500: { description: "Failed to fetch leaderboard" },
    },
    operationId: "getPublicLeaderboard",
  },
});

export default defineEventHandler(async () => {
  try {
    const users = await prisma.user.findMany({
      select: { id: true },
      where: {
        leaderboardEnabled: true,
      },
    });

    const leaderboard = await Promise.all(
      users.map(async (user) => {
        const summaries = await prisma.summaries.findMany({
          where: { userId: user.id },
          select: {
            totalMinutes: true,
            editors: true,
            os: true,
            languages: true,
          },
        });

        const totalMinutes = summaries.reduce(
          (sum, s) => sum + (s.totalMinutes || 0),
          0,
        );

        function getTop(obj?: Record<string, number> | null): string | null {
          if (!obj) return null;
          const entries = Object.entries(obj);
          if (entries.length === 0) return null;
          return entries.sort((a, b) => b[1] - a[1])[0][0];
        }

        const mergedEditors: Record<string, number> = {};
        const mergedOS: Record<string, number> = {};
        const mergedLanguages: Record<string, number> = {};

        for (const s of summaries) {
          if (s.editors) {
            for (const [k, v] of Object.entries(s.editors)) {
              mergedEditors[k] = (mergedEditors[k] || 0) + (v as number);
            }
          }
          if (s.os) {
            for (const [k, v] of Object.entries(s.os)) {
              mergedOS[k] = (mergedOS[k] || 0) + (v as number);
            }
          }
          if (s.languages) {
            for (const [k, v] of Object.entries(s.languages)) {
              mergedLanguages[k] = (mergedLanguages[k] || 0) + (v as number);
            }
          }
        }

        return {
          userId: user.id,
          totalMinutes,
          topEditor: getTop(mergedEditors),
          topOS: getTop(mergedOS),
          topLanguage: getTop(mergedLanguages),
        };
      }),
    );

    leaderboard.sort((a, b) => b.totalMinutes - a.totalMinutes);

    return leaderboard;
  } catch (error: any) {
    throw handleApiError(
      500,
      error instanceof Error ? error.message : "Unknown leaderboard error",
      "Failed to fetch leaderboard",
    );
  }
});
