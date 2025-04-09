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
  const body = await readBody(event);
  const config = useRuntimeConfig();

  if (
    !body.email ||
    !body.password ||
    typeof body.email !== "string" ||
    typeof body.password !== "string"
  ) {
    throw createError({
      statusCode: 400,
      message: "Email and Password are required",
    });
  }

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
      throw createError({
        statusCode: 400,
        message: "Email already in use",
      });
    }

    const saltRounds = 10;
    const passwordHash = await bcrypt.hash(body.password, saltRounds);

    const user = await prisma.user.create({
      data: {
        email: body.email,
        passwordHash,
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

    setCookie(event, "session", token, {
      expires: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      path: "/",
      httpOnly: true,
      secure: true,
      sameSite: "strict",
    });

    return sendRedirect(event, "/");
  } catch (error) {
    throw createError({
      statusCode: 400,
      message:
        error instanceof Error
          ? error.message
          : "Registration failed. Please try again.",
    });
  }
});
