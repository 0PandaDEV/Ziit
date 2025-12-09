import { prisma } from "~~/prisma/db";
import { handleApiError } from "~~/server/utils/logging";

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

export default defineCachedEventHandler(
  async () => {
    try {
      const leaderboardData = await prisma.$queryRaw<
        Array<{
          user_id: string;
          total_minutes: number;
          top_editor: string | null;
          top_os: string | null;
          top_language: string | null;
        }>
      >`
        SELECT * FROM get_leaderboard_stats()
      `;

      return leaderboardData.map((row) => ({
        userId: row.user_id,
        totalMinutes: row.total_minutes,
        topEditor: row.top_editor,
        topOS: row.top_os,
        topLanguage: row.top_language,
      }));
    } catch (fallbackError) {
      console.error("Even basic query failed:", fallbackError);
      throw handleApiError(
        69,
        "Database query failed. Please try again later.",
        "Failed to fetch leaderboard"
      );
    }
  },
  {
    maxAge: 5 * 60,
  }
);
