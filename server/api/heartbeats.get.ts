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
        message: "Invalid session" + error,
      });
    }
  }

  try {
    const query = getQuery(event);
    const project = query.project as string;
    const editor = query.editor as string;
    const os = query.os as string;

    const whereCondition: any = {
      userId: userId,
    };

    if (project) {
      whereCondition.project = project;
    }
    if (editor) {
      whereCondition.editor = editor;
    }
    if (os) {
      whereCondition.os = os;
    }

    const heartbeats = await prisma.heartbeat.findMany({
      where: whereCondition,
      orderBy: {
        timestamp: "desc" as const,
      },
      take: 50,
    });

    return heartbeats;
  } catch (error: any) {
    if (error.statusCode) {
      throw error;
    }
    console.error("Error fetching recent heartbeats:", error);
    throw createError({
      statusCode: 500,
      statusMessage: "Internal server error",
    });
  }
});
