import { PrismaClient } from "@prisma/client";
import { H3Event } from "h3";
import { z } from "zod";
import bcrypt from "bcrypt";
import { handleApiError } from "~/server/utils/error";

const prisma = new PrismaClient();

const passwordSchema = z
  .string()
  .min(12, "Password must be at least 12 characters")
  .regex(/[A-Z]/, "Password must contain at least one uppercase letter")
  .regex(/[a-z]/, "Password must contain at least one lowercase letter")
  .regex(/[0-9]/, "Password must contain at least one number")
  .regex(
    /[^A-Za-z0-9]/,
    "Password must contain at least one special character"
  );

const userSettingsSchema = z.object({
  keystrokeTimeout: z.number().min(1).max(60).optional(),
  email: z.string().email().optional(),
  password: passwordSchema.optional(),
});

export default defineEventHandler(async (event: H3Event) => {
  try {
    const body = await readBody(event);

    const validatedData = userSettingsSchema.safeParse(body);

    if (!validatedData.success) {
      const errorDetail = `Invalid user settings data for user ${event.context.user.id}: ${validatedData.error.message}`;
      const clientMessage = validatedData.error.errors[0]?.message || "Invalid user settings data.";
      throw handleApiError(400, errorDetail, clientMessage );
    }

    const updateData: {
      keystrokeTimeout?: number;
      email?: string;
      passwordHash?: string;
    } = {};

    if (validatedData.data.keystrokeTimeout !== undefined) {
      updateData.keystrokeTimeout = validatedData.data.keystrokeTimeout;
    }

    if (validatedData.data.email !== undefined) {
      const existingUser = await prisma.user.findUnique({
        where: { email: validatedData.data.email },
      });

      if (existingUser && existingUser.id !== event.context.user.id) {
        const errorDetail = `User settings update failed for user ${event.context.user.id}: Email ${validatedData.data.email} already in use by another account.`;
        throw handleApiError(409, errorDetail);
      }

      updateData.email = validatedData.data.email;
    }

    if (validatedData.data.password !== undefined) {
      const saltRounds = 10;
      const passwordHash = await bcrypt.hash(
        validatedData.data.password,
        saltRounds
      );
      updateData.passwordHash = passwordHash;
    }

    if (Object.keys(updateData).length > 0) {
      await prisma.user.update({
        where: {
          id: event.context.user.id,
        },
        data: updateData,
      });
    }

    return { success: true };
  } catch (error: any) {
    if (error && typeof error === 'object' && '__h3_error__' in error) {
      throw error;
    }
    const detailedMessage = error instanceof Error ? error.message : "An unknown error occurred while updating user settings.";
    throw handleApiError(
      500,
      `Failed to update user settings for user ${event.context.user.id}: ${detailedMessage}`,
      "Failed to update user settings. Please try again."
    );
  }
});
