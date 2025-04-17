import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { prisma } from "~~/prisma/prisma";
import { z } from "zod";

const passwordSchema = z.string()
  .min(12, "Password must be at least 8 characters")
  .regex(/[A-Z]/, "Password must contain at least one uppercase letter")
  .regex(/[a-z]/, "Password must contain at least one lowercase letter")
  .regex(/[0-9]/, "Password must contain at least one number")
  .regex(/[^A-Za-z0-9]/, "Password must contain at least one special character");

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
    console.error("Registration error: missing credentials");
    throw createError({
      statusCode: 400,
      message: "Email and Password are required",
    });
  }
  
  const timezone = body.timezone && typeof body.timezone === "string" 
    ? body.timezone 
    : "UTC";

  try {
    const passwordValidation = passwordSchema.safeParse(body.password);
    if (!passwordValidation.success) {
      throw createError({
        statusCode: 400,
        message: passwordValidation.error.errors[0].message,
      });
    }

    const existingUser = await prisma.user.findUnique({
      where: { email: body.email },
    });

    if (existingUser) {
      console.error("Registration error: email already in use");
      throw createError({
        statusCode: 409,
        message: "Email already in use",
      });
    }

    const saltRounds = 10;
    const passwordHash = await bcrypt.hash(body.password, saltRounds);

    const user = await prisma.user.create({
      data: {
        email: body.email,
        passwordHash,
        timezone,
      },
    });

    const token = jwt.sign(
      {
        userId: user.id,
        email: user.email,
      },
      config.jwtSecret,
      { expiresIn: "7d" },
    );

    setCookie(event, "ziit_session", token, {
      expires: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      path: "/",
      httpOnly: true,
      secure: true,
      sameSite: "strict",
    });

    return sendRedirect(event, "/");
  } catch (error) {
    console.error("Registration error:", error instanceof Error ? error.message : "Unknown error");
    throw createError({
      statusCode: 500,
      message: "Registration failed",
    });
  }
});
