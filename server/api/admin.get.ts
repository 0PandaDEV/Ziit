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
      const users = await prisma.user.findMany({
        select: {
          id: true,
          email: true,
          githubUsername: true,
          createdAt: true,
          lastlogin: true,
          _count: {
            select: {
              heartbeats: true,
              summaries: true,
            },
          },
        },
      });

      const usersWithTotalMinutes = await Promise.all(
        users.map(async (user) => {
          const summaries = await prisma.summaries.findMany({
            where: { userId: user.id },
            select: {
              totalMinutes: true,
            },
          });

          const totalMinutes = summaries.reduce(
            (sum, s) => sum + (s.totalMinutes || 0),
            0
          );

          return {
            ...user,
            totalMinutes,
          };
        })
      );

      return usersWithTotalMinutes;
    }
  } catch (error) {
    const adminKey =
      getHeader(event, "authorization")?.substring(7, 11) || "UNKNOWN";
    throw handleApiError(
      911,
      `Admin API error: Error occurred getting the user data. API Key prefix: ${adminKey}... Error: ${
        error instanceof Error
          ? error.message
          : "An unknown error occurred getting the user data."
      }`,
      "Failed to process your request."
    );
  }
});
