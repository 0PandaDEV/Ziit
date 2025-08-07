import { H3Event } from "h3";
import { regenerateSummariesForUser } from "~~/server/utils/summarize";
import { handleApiError} from "~~/server/utils/logging";

export default defineEventHandler(async (event: H3Event) => {
  try {
    const userId = event.context.user.id;
    const result = await regenerateSummariesForUser(userId);
    return result;
  } catch (error: any) {
    if (error && typeof error === "object" && error.statusCode) throw error;
    const userId = event.context.user.id;
    const detailedMessage = error instanceof Error ? error.message : "An unknown error occurred during summary regeneration.";
    throw handleApiError(
      500,
      `Failed to regenerate summaries for user ${userId}: ${detailedMessage}`,
      "Failed to regenerate summaries. Please try again."
    );
  }
});
