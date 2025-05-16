import { PrismaClient } from "@prisma/client";
import { H3Event } from "h3";
import { handleApiError } from "~/server/utils/error";

const prisma = new PrismaClient();

export default defineEventHandler(async (event: H3Event) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: event.context.user.id },
      select: {
        id: true,
        email: true,
        githubId: true,
        githubUsername: true,
        apiKey: true,
        keystrokeTimeout: true
      },
    });

    if (!user) {
      console.error(
        `User error: User not found for ID ${event.context.user.id}`,
      );
      throw handleApiError(404, `User not found for ID ${event.context.user.id}`);
    }

    return user;
  } catch (error: any) {
    return handleApiError(error, "Failed to fetch user data");
  }
});
