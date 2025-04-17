import { PrismaClient } from "@prisma/client";
import { H3Event } from "h3";
import { z } from "zod";
import bcrypt from "bcrypt";

const prisma = new PrismaClient();

const passwordSchema = z.string()
  .min(12, "Password must be at least 12 characters")
  .regex(/[A-Z]/, "Password must contain at least one uppercase letter")
  .regex(/[a-z]/, "Password must contain at least one lowercase letter")
  .regex(/[0-9]/, "Password must contain at least one number")
  .regex(/[^A-Za-z0-9]/, "Password must contain at least one special character");

const userSettingsSchema = z.object({
  keystrokeTimeout: z.number().min(1).max(60).optional(),
  email: z.string().email().optional(),
  password: passwordSchema.optional(),
  timezone: z.string().refine(
    (tz) => Intl.DateTimeFormat(undefined, { timeZone: tz }).resolvedOptions().timeZone === tz,
    { message: "Invalid timezone" }
  ).optional()
});

export default defineEventHandler(async (event: H3Event) => {
  try {
    const body = await readBody(event);
    
    const validatedData = userSettingsSchema.safeParse(body);
    
    if (!validatedData.success) {
      throw createError({
        statusCode: 400,
        message: "Invalid user settings data" + validatedData.error
      });
    }
    
    const updateData: {
      keystrokeTimeout?: number;
      email?: string;
      passwordHash?: string;
      timezone?: string;
    } = {};
    
    if (validatedData.data.keystrokeTimeout !== undefined) {
      updateData.keystrokeTimeout = validatedData.data.keystrokeTimeout;
    }
    
    if (validatedData.data.email !== undefined) {
      const existingUser = await prisma.user.findUnique({
        where: { email: validatedData.data.email },
      });
      
      if (existingUser && existingUser.id !== event.context.user.id) {
        throw createError({
          statusCode: 409,
          message: "Email already in use"
        });
      }
      
      updateData.email = validatedData.data.email;
    }
    
    if (validatedData.data.password !== undefined) {
      const saltRounds = 10;
      const passwordHash = await bcrypt.hash(validatedData.data.password, saltRounds);
      updateData.passwordHash = passwordHash;
    }
    
    if (validatedData.data.timezone !== undefined) {
      updateData.timezone = validatedData.data.timezone;
    }
    
    if (Object.keys(updateData).length > 0) {
      await prisma.user.update({
        where: {
          id: event.context.user.id,
        },
        data: updateData,
      });
      
      console.log(`Updated settings for user ${event.context.user.id}`);
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
