import { z } from "zod";
import { prisma } from "~~/prisma/prisma";
import { H3Event } from "h3";

const adminKeySchema = z.base64();

export default defineEventHandler(async (event: H3Event) => {
  try {
    const authHeader = getHeader(event, "authorization");
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      throw handleApiError(
        401,
        "Admin API error: Missing or invalid Admin key format in header.",
      );
    }

    const config = useRuntimeConfig();
    const adminKey = authHeader.substring(7);
    const validatedAdminKey = adminKeySchema.safeParse(adminKey);

    if (!validatedAdminKey.success) {
      throw handleApiError(401, `Admin API error: Invalid Admin key format.`);
    }

    if (validatedAdminKey.data === config.adminKey) {
      const usersWithStats = await prisma.$queryRaw<
        Array<{
          id: string;
          email: string;
          githubUsername: string | null;
          createdAt: Date;
          lastlogin: Date;
          heartbeats_count: string;
          summaries_count: string;
          total_minutes: string;
        }>
      >`
        SELECT
          u.id,
          u.email,
          u."githubUsername",
          u."createdAt",
          u.lastlogin,
          COALESCE(h.heartbeats_count, 0)::text as heartbeats_count,
          COALESCE(s.summaries_count, 0)::text as summaries_count,
          COALESCE(s.total_minutes, 0)::text as total_minutes
        FROM "User" u
        LEFT JOIN (
          SELECT
            "userId",
            COUNT(*) as heartbeats_count
          FROM "Heartbeats"
          GROUP BY "userId"
        ) h ON u.id = h."userId"
        LEFT JOIN (
          SELECT
            "userId",
            COUNT(*) as summaries_count,
            SUM("totalMinutes") as total_minutes
          FROM "Summaries"
          GROUP BY "userId"
        ) s ON u.id = s."userId"
        ORDER BY u."createdAt" DESC
      `;

      const usersWithTotalMinutes = usersWithStats.map((user) => ({
        id: user.id,
        email: user.email,
        githubUsername: user.githubUsername,
        createdAt: user.createdAt,
        lastlogin: user.lastlogin,
        _count: {
          heartbeats: parseInt(user.heartbeats_count),
          summaries: parseInt(user.summaries_count),
        },
        totalMinutes: parseInt(user.total_minutes),
      }));

      return usersWithTotalMinutes;
    }
  } catch (error) {
    const adminKey =
      getHeader(event, "authorization")?.substring(7, 11) || "UNKNOWN";
    throw handleApiError(
      69,
      `Admin API error: Error occurred getting the user data. API Key prefix: ${adminKey}... Error: ${
        error instanceof Error
          ? error.message
          : "An unknown error occurred getting the user data."
      }`,
      "Failed to process your request.",
    );
  }
});
