import { H3Event } from "h3";
import { regenerateSummariesForUser } from "~/server/utils/summarize";

export default defineEventHandler(async (event: H3Event) => {
  try {
    const userId = event.context.user.id;
    const result = await regenerateSummariesForUser(userId);
    return result;
  } catch (error) {
    console.error(
      "Regenerate summaries error:",
      error instanceof Error ? error.message : "Unknown error"
    );
    throw createError({
      statusCode: 500,
      message: "Failed to regenerate summaries",
    });
  }
});
