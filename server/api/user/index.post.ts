import { PrismaClient } from "@prisma/client";
import { H3Event } from "h3";
import { z } from "zod";

const prisma = new PrismaClient();

const userSettingsSchema = z.object({
  keystrokeTimeout: z.number().min(1).max(60).optional()
});

export default defineEventHandler(async (event: H3Event) => {
  try {
    const body = await readBody(event);
    
    const validatedData = userSettingsSchema.safeParse(body);
    
    if (!validatedData.success) {
      throw createError({
        statusCode: 400,
        message: "Invalid user settings data"
      });
    }
    
    if (validatedData.data.keystrokeTimeout !== undefined) {
      const timeout = validatedData.data.keystrokeTimeout;
      
      await prisma.user.update({
        where: {
          id: event.context.user.id,
        },
        data: {
          keystrokeTimeout: timeout,
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
