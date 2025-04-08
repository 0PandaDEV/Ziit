import { H3Event } from "h3";
import { summarizeHeartbeats } from "~/server/utils/summarize-heartbeats";

export default defineEventHandler(async (event: H3Event) => {
  if (!event.context.user) {
    throw createError({
      statusCode: 401,
      message: "Unauthorized",
    });
  }

  try {
    const success = await summarizeHeartbeats();

    return {
      success,
      timestamp: new Date().toISOString(),
    };
  } catch (error: any) {
    console.error("Error in cron job:", error);

    throw createError({
      statusCode: 500,
      statusMessage: "Internal server error",
    });
  }
});
