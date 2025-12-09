import { z } from "zod";
import { prisma } from "~~/prisma/db";
import { H3Event } from "h3";

const adminKeySchema = z.base64();

export default defineEventHandler(async (event: H3Event) => {
  try {
    const authHeader = getHeader(event, "authorization");
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      throw handleApiError(
        401,
        "Admin API error: Missing or invalid Admin key format in header."
      );
    }

    const config = useRuntimeConfig();
    const adminKey = authHeader.substring(7);
    const validatedAdminKey = adminKeySchema.safeParse(adminKey);

    if (!validatedAdminKey.success) {
      throw handleApiError(401, `Admin API error: Invalid Admin key format.`);
    }

    if (validatedAdminKey.data === config.adminKey) {
      const results = await prisma.$queryRaw<
        Array<{
          id: string;
          email: string;
          github_username: string | null;
          created_at: Date;
          last_login: Date;
          heartbeats_count: number;
          summaries_count: number;
          total_minutes: number;
        }>
      >`SELECT * FROM get_admin_dashboard_stats()`;

      return results.map((user) => ({
        id: user.id,
        email: user.email,
        github_username: user.github_username,
        created_at: user.created_at,
        last_login: user.last_login,
        heartbeats_count: Number(user.heartbeats_count),
        summaries_count: Number(user.summaries_count),
        total_minutes: Number(user.total_minutes),
      }));
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
      "Failed to process your request."
    );
  }
});
