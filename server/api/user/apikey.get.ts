import { PrismaClient } from "@prisma/client";
import { H3Event } from "h3";
import { handleApiError } from "~/server/utils/error";

const prisma = new PrismaClient();

export default defineEventHandler(async (event: H3Event) => {
  try {
    const apiKey = crypto.randomUUID();

    const updatedUser = await prisma.user.update({
      where: {
        id: event.context.user.id,
      },
      data: {
        apiKey,
      },
      select: {
        apiKey: true,
      },
    });

    return {
      apiKey: updatedUser.apiKey,
    };
  } catch (error: any) {
    return handleApiError(error, "Failed to generate API key");
  }
});
