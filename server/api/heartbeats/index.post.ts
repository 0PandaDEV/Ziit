import { PrismaClient } from "@prisma/client";
import { H3Event } from "h3";
import jwt from "jsonwebtoken";

const prisma = new PrismaClient();

export default defineEventHandler(async (event: H3Event) => {
  let userId;

  if (event.context.user) {
    userId = event.context.user.id;
  } else {
    const sessionCookie = getCookie(event, "session");

    if (!sessionCookie) {
      throw createError({
        statusCode: 401,
        message: "Unauthorized",
      });
    }

    try {
      const config = useRuntimeConfig();
      const decoded = jwt.verify(sessionCookie, config.jwtSecret);

      if (
        typeof decoded !== "object" ||
        decoded === null ||
        !("userId" in decoded)
      ) {
        throw new Error("Invalid token format");
      }

      userId = decoded.userId;
    } catch (error) {
      deleteCookie(event, "session");
      throw createError({
        statusCode: 401,
        message: "Invalid session",
      });
    }
  }

  try {
    const body = await readBody(event);

    if (!body || !body.timestamp) {
      throw createError({
        statusCode: 400,
        statusMessage: "Bad request: Missing required fields",
      });
    }

    const heartbeat = await prisma.heartbeat.create({
      data: {
        userId: userId,
        timestamp: new Date(body.timestamp),
        project: body.project,
        language: body.language,
        file: body.file,
      },
    });

    return {
      success: true,
      id: heartbeat.id,
    };
  } catch (error: any) {
    if (error.statusCode) {
      throw error;
    }
    console.error("Error processing heartbeat:", error);
    throw createError({
      statusCode: 500,
      statusMessage: "Internal server error",
    });
  }
});
