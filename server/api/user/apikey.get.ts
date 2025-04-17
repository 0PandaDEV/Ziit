import { PrismaClient } from "@prisma/client";
import { H3Event } from "h3";

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
    console.error(
      "API Key error:",
      error instanceof Error ? error.message : "Unknown error",
    );
    throw createError({
      statusCode: 500,
      message: "Failed to generate API key",
    });
  }
});
