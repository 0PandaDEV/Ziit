import { PrismaClient } from "@prisma/client";
import { H3Event } from "h3";
import { v4 as uuidv4 } from "uuid";

const prisma = new PrismaClient();

export default defineEventHandler(async (event: H3Event) => {
  if (!event.context.user) {
    throw createError({
      statusCode: 401,
      message: "Unauthorized",
    });
  }

  try {
    const apiKey = uuidv4();

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
    console.error("Error regenerating API key:", error);
    throw createError({
      statusCode: error.statusCode || 500,
      statusMessage: error.statusMessage || "Internal server error",
    });
  }
});
