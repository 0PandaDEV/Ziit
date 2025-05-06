import { H3Event } from "h3";
import { regenerateSummariesForUser } from "~/server/utils/summarize";
import { handleApiError } from "~/server/utils/error";

export default defineEventHandler(async (event: H3Event) => {
  try {
    const userId = event.context.user.id;
    const result = await regenerateSummariesForUser(userId);
    return result;
  } catch (error) {
    return handleApiError(error, "Failed to regenerate summaries");
  }
});
