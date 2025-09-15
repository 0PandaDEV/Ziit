import bcrypt from "bcrypt";
import { encrypt } from "paseto-ts/v4";
import { prisma } from "~~/prisma/prisma";
import { z } from "zod";
import { handleApiError} from "~~/server/utils/logging";

defineRouteMeta({
  openAPI: {
    tags: ["Auth"],
    summary: "Register a new user",
    description: "Creates a user account and sets a session cookie.",
    requestBody: {
      required: true,
      content: {
        "application/json": {
          schema: {
            type: "object",
            properties: {
              email: { type: "string", format: "email" },
              password: { type: "string", description: "At least 12 characters with upper/lowercase, number, and special char." },
            },
            required: ["email", "password"],
          },
        },
      },
    },
    responses: {
      302: { description: "Redirect on success" },
      400: { description: "Validation error" },
      409: { description: "Email already in use" },
      500: { description: "Registration failed" },
    },
    operationId: "postRegister",
  },
});

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

export default defineEventHandler(async (event) => {
  const config = useRuntimeConfig();

  if (config.disableRegistering === "true") {
    throw createError({
      statusCode: 403,
      message: "Registration is currently disabled",
    });
  }

  const body = await readBody(event);

  if (
    !body.email ||
    !body.password ||
    typeof body.email !== "string" ||
    typeof body.password !== "string"
  ) {
    throw handleApiError(
      400,
      "Registration attempt with missing email or password.",
      "Email and password are required."
    );
  }

  try {
    const passwordValidation = passwordSchema.safeParse(body.password);
    if (!passwordValidation.success) {
      const errorDetail = `Password validation failed for email ${body.email}: ${passwordValidation.error.message}`;
      throw handleApiError(
        400,
        errorDetail,
        passwordValidation.error.message
      );
    }

    const existingUser = await prisma.user.findUnique({
      where: { email: body.email },
    });

    if (existingUser) {
      throw handleApiError(
        409,
        `Registration attempt with existing email: ${body.email}.`
      );
    }

    const saltRounds = 10;
    const passwordHash = await bcrypt.hash(body.password, saltRounds);

    const user = await prisma.user.create({
      data: {
        email: body.email,
        passwordHash,
      },
    });

    const token = encrypt(config.pasetoKey, {
      userId: user.id,
      email: user.email,
      exp: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    });

    setCookie(event, "ziit_session", token, {
      expires: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      path: "/",
      httpOnly: true,
      secure: true,
      sameSite: "strict",
    });

    return sendRedirect(event, "/");
  } catch (error: any) {
    if (error && typeof error === "object" && error.statusCode) {
      throw error;
    }
    const detailedMessage =
      error instanceof Error
        ? error.message
        : "An unknown error occurred during registration.";
    throw handleApiError(
      69,
      `Registration failed: ${detailedMessage}`,
      "An unexpected error occurred during registration. Please try again."
    );
  }
});
