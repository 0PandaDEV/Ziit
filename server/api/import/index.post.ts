import { H3Event } from "h3";
import z from "zod";
import { handleApiError, handleLog } from "~~/server/utils/logging";
import { handleWakApiImport } from "~~/server/utils/wakapi";
import { handleWakatimeImport } from "~~/server/utils/wakatime";
import { activeJobs } from "~~/server/utils/import-jobs";

export const requestSchema = z.discriminatedUnion("instanceType", [
  z.object({
    instanceType: z.literal("wakapi"),
    apiKey: z.uuid("API key must be a valid UUID"),
    instanceUrl: z.url("Instance URL must be valid").optional(),
  }),
  z.object({
    instanceType: z.literal("wakatime"),
    apiKey: z
      .string()
      .regex(
        /^waka_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
        "API key must be in format waka_<uuid>",
      ),
    instanceUrl: z.string().optional(),
  }),
]);

export default defineEventHandler(async (event: H3Event) => {
  const body = await readBody(event);
  const userId = event.context.user.id;
  handleLog("Processing for user ID:", userId);

  for (const [jobId, job] of activeJobs.entries()) {
    if (job.userId === userId) {
      activeJobs.delete(jobId);
    }
  }

  const validationResult = requestSchema.safeParse(body);

  if (validationResult.data?.instanceType == "wakapi") {
    const { apiKey, instanceType, instanceUrl } = validationResult.data;

    if (!instanceUrl) {
      const errorDetail = `WakAPI instance URL missing for user ${userId}.`;
      throw handleApiError(400, errorDetail, "WakAPI instance URL is missing.");
    }

    handleLog("Received Data Import request with:", {
      instanceType,
      instanceUrl: "provided",
    });

    return handleWakApiImport(apiKey, instanceUrl, userId);
  }

  if (validationResult.data?.instanceType == "wakatime") {
    const { apiKey, instanceType } = validationResult.data;

    handleLog("Received Data Import request with:", { instanceType });

    return handleWakatimeImport(apiKey, userId);
  }

  console.log(body);

  throw handleApiError(
    400,
    `Invalid request data for user ${userId}`,
    "Invalid API request data.",
  );
});
