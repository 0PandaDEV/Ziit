import bcrypt from "bcrypt";
import { encrypt } from "paseto-ts/v4";
import { prisma } from "~~/prisma/prisma";
import { z } from "zod";
import { createStandardError, handleApiError } from "~/server/utils/error";

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
    throw createStandardError(400, validation.error.errors[0].message || "Email and password are required");
  }

  try {
    const { email, password } = validation.data;

    const user = await prisma.user.findUnique({
      where: { email },
    });

    if (!user || !user.passwordHash) {
      console.error("Login error: invalid credentials");
      throw createStandardError(401, "Invalid email or password");
    }

    const isPasswordValid = await bcrypt.compare(password, user.passwordHash);

    if (!isPasswordValid) {
      console.error("Login error: invalid credentials");
      throw createStandardError(401, "Invalid email or password");
    }

    const token = encrypt(
      config.pasetoKey,
      {
        userId: user.id,
        email: user.email,
        exp: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      }
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
    return handleApiError(error, "Authentication failed");
  }
});
