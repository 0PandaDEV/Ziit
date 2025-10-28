import { prisma } from "~~/prisma/prisma";
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
          userId: string;
          totalMinutes: string;
        }>
      >`
      SELECT
        "userId",
        SUM("totalMinutes")::text as "totalMinutes"
      FROM "Summaries" s
      WHERE EXISTS (
        SELECT 1 FROM "User" u
        WHERE u.id = s."userId"
        AND u."leaderboardEnabled" = true
      )
      GROUP BY "userId"
      HAVING SUM("totalMinutes") > 0
      ORDER BY SUM("totalMinutes") DESC
      LIMIT 100
    `;

      const leaderboard = await Promise.all(
        leaderboardData.map(async (item) => {
          const [topEditor, topOS, topLanguage] = await Promise.all([
            prisma.$queryRaw<Array<{ editor: string }>>`
            SELECT editor
            FROM "Heartbeats"
            WHERE "userId" = ${item.userId}
              AND editor IS NOT NULL
            GROUP BY editor
            ORDER BY COUNT(*) DESC
            LIMIT 1
          `,
            prisma.$queryRaw<Array<{ os: string }>>`
            SELECT os
            FROM "Heartbeats"
            WHERE "userId" = ${item.userId}
              AND os IS NOT NULL
            GROUP BY os
            ORDER BY COUNT(*) DESC
            LIMIT 1
          `,
            prisma.$queryRaw<Array<{ language: string }>>`
            SELECT language
            FROM "Heartbeats"
            WHERE "userId" = ${item.userId}
              AND language IS NOT NULL
            GROUP BY language
            ORDER BY COUNT(*) DESC
            LIMIT 1
          `,
          ]);

          return {
            userId: item.userId,
            totalMinutes: parseInt(item.totalMinutes),
            topEditor: topEditor[0]?.editor || null,
            topOS: topOS[0]?.os || null,
            topLanguage: topLanguage[0]?.language || null,
          };
        })
      );

      return leaderboard;
    } catch (error: any) {
      throw handleApiError(
        69,
        error instanceof Error ? error.message : "Unknown leaderboard error",
        "Failed to fetch leaderboard"
      );
    }
  },
  { maxAge: 1440 * 60 }
);
