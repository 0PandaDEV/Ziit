import { PrismaClient } from "@prisma/client";
import { H3Event } from "h3";

const prisma = new PrismaClient();

export default defineEventHandler(async (event: H3Event) => {
  if (!event.context.user) {
    throw createError({
      statusCode: 401,
      message: "Unauthorized",
    });
  }

  try {
    const body = await readBody(event);
    
    if (body.keystrokeTimeoutMinutes !== undefined) {
      const timeout = Number(body.keystrokeTimeoutMinutes);
      
      if (isNaN(timeout) || timeout < 1 || timeout > 60) {
        throw createError({
          statusCode: 400,
          message: "Keystroke timeout must be between 1 and 60 minutes",
        });
      }
      
      await prisma.user.update({
        where: {
          id: event.context.user.id,
        },
        data: {
          keystrokeTimeoutMinutes: timeout,
        },
      });
      
      console.log(`Updated keystroke timeout for user ${event.context.user.id} to ${timeout} minutes`);
    }

    return { success: true };
  } catch (error: any) {
    console.error("Error updating user settings:", error);
    throw createError({
      statusCode: error.statusCode || 500,
      message: error.message || "Failed to update user settings",
    });
  }
});
