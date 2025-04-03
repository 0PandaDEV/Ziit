import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { prisma } from "~~/prisma/prisma";

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
      message: "Email and password are required",
    });
  }

  try {
    const user = await prisma.user.findUnique({
      where: { email: body.email },
    });

    if (!user || !user.passwordHash) {
      throw createError({
        statusCode: 401,
        message: "Invalid email or password",
      });
    }

    const passwordMatch = await bcrypt.compare(
      body.password,
      user.passwordHash
    );

    if (!passwordMatch) {
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
      { expiresIn: "7d" }
    );

    setCookie(event, "session", token, {
      expires: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      path: "/",
      httpOnly: true,
      secure: true,
      sameSite: "strict",
    });

    await sendRedirect(event, "/");
  } catch (error) {
    throw createError({
      statusCode: 401,
      message:
        error instanceof Error ? error.message : "Invalid email or password",
    });
  }
});
