import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { prisma } from "~~/prisma/prisma";
import { z } from "zod";

const loginSchema = z.object({
  email: z.string().email("Invalid email format"),
  password: z.string().min(1, "Password is required"),
});

export default defineEventHandler(async (event) => {
  const body = await readBody(event);
  const config = useRuntimeConfig();

  const validation = loginSchema.safeParse(body);

  if (!validation.success) {
    console.error("Login error: invalid input", validation.error.errors);
    throw createError({
      statusCode: 400,
      message:
        validation.error.errors[0].message || "Email and password are required",
    });
  }

  try {
    const { email, password } = validation.data;

    const user = await prisma.user.findUnique({
      where: { email },
    });

    if (!user || !user.passwordHash) {
      console.error("Login error: invalid credentials");
      throw createError({
        statusCode: 401,
        message: "Invalid email or password",
      });
    }

    const isPasswordValid = await bcrypt.compare(password, user.passwordHash);

    if (!isPasswordValid) {
      console.error("Login error: invalid credentials");
      throw createError({
        statusCode: 401,
        message: "Invalid email or password",
      });
    }

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

    await sendRedirect(event, "/");
  } catch (error) {
    console.error(
      "Login error:",
      error instanceof Error ? error.message : "Unknown error",
    );
    throw createError({
      statusCode: 500,
      message: "Invalid email or password",
    });
  }
});
