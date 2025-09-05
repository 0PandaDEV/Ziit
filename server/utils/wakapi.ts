import { processHeartbeatsByDate } from "~~/server/utils/summarize";
import { handleApiError, handleLog } from "~~/server/utils/logging";
import { activeJobs, type ImportJob } from "~~/server/utils/import-queue";
import { randomUUID } from "crypto";
import path from "path";
import { parseUserAgent } from "./wakatime";

interface WakApiHeartbeat {
  id: string;
  branch: string;
  category: string;
  entity: string;
  is_write: boolean;
  language: string;
  project: string;
  time: number;
  type: string;
  user_id: string;
  machine_name_id: string;
  user_agent_id: string;
  lines: number;
  lineno: number;
  cursorpos: number;
  line_deletions: number;
  line_additions: number;
  created_at: string;
}

function processWakaApiHeartbeat(heartbeat: WakApiHeartbeat, userId: string) {
  return {
    userId: userId,
    timestamp: heartbeat.time
      ? BigInt(Math.round(heartbeat.time * 1000))
      : BigInt(new Date().getTime()),
    project: heartbeat.project || null,
    editor: parseUserAgent(heartbeat.user_agent_id).editor,
    language: heartbeat.language || null,
    os: parseUserAgent(heartbeat.user_agent_id).os,
    file: heartbeat.entity ? path.basename(heartbeat.entity) : null,
    branch: heartbeat.branch || null,
    createdAt: new Date(),
    summariesId: null,
  };
}

async function fetchWakApiHeartbeats(
  baseUrl: string,
  userIdentifier: string,
  headers: any,
  startDate: Date,
  endDate: Date,
  userId: string,
  job?: ImportJob,
) {
  handleLog(
    `Fetching heartbeats from ${startDate.toISOString()} to ${endDate.toISOString()}`,
  );

  const today = new Date();
  const adjustedEndDate = new Date();
  adjustedEndDate.setHours(23, 59, 59, 999);

  if (endDate < adjustedEndDate) endDate = adjustedEndDate;

  const allDateStrings: string[] = [];
  const currentDate = new Date(startDate);
  while (currentDate <= endDate) {
    allDateStrings.push(currentDate.toISOString().split("T")[0]);
    currentDate.setDate(currentDate.getDate() + 1);
  }

  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowStr = tomorrow.toISOString().split("T")[0];
  if (!allDateStrings.includes(tomorrowStr)) allDateStrings.push(tomorrowStr);

  handleLog(
    `Generated ${allDateStrings.length} dates to check based on date range, including tomorrow to ensure all heartbeats are captured`,
  );

  if (job) {
    job.totalToProcess = allDateStrings.length;
    job.processedCount = 0;
    job.status = "Processing heartbeats";
    activeJobs.set(job.id, job);
  }

  const heartbeatsByDate = new Map<string, any[]>();
  const progressUpdateInterval = Math.max(
    1,
    Math.floor(allDateStrings.length / 10),
  );

  for (let i = 0; i < allDateStrings.length; i++) {
    const dateStr = allDateStrings[i];

    if (i % progressUpdateInterval === 0 || i === allDateStrings.length - 1) {
      handleLog(
        `Processing date ${i + 1}/${allDateStrings.length}: ${dateStr} (${Math.round(((i + 1) / allDateStrings.length) * 100)}% complete)`,
      );
    }

    try {
      const heartbeatsUrl = `${baseUrl}/users/${userIdentifier}/heartbeats`;
      const heartbeatsResponse = await $fetch<{ data: WakApiHeartbeat[] }>(
        heartbeatsUrl,
        {
          params: { date: dateStr },
          headers,
        },
      );

      if (!heartbeatsResponse?.data || heartbeatsResponse.data.length === 0) {
        if (i % progressUpdateInterval === 0)
          handleLog(`No heartbeats found for ${dateStr}`);
        continue;
      }

      if (i % progressUpdateInterval === 0) {
        handleLog(
          `Found ${heartbeatsResponse.data.length} heartbeats for ${dateStr}`,
        );
      }

      const heartbeats = heartbeatsResponse.data.map((h) =>
        processWakaApiHeartbeat(h, userId),
      );

      if (heartbeats.length > 0) {
        heartbeatsByDate.set(dateStr, heartbeats);
        await processHeartbeatsByDate(userId, heartbeats);
      }

      if (job) {
        job.processedCount! += 1;
        job.progress = Math.round(
          (job.processedCount! / job.totalToProcess!) * 100,
        );
        activeJobs.set(job.id, job);
      }
    } catch (error) {
      handleApiError(
        911,
        `Error fetching heartbeats for ${dateStr} for user ${userId}: ${error instanceof Error ? error.message : String(error)}`,
        "An error occurred while fetching some activity data. The import may be incomplete.",
      );
    }

    await new Promise((resolve) => setTimeout(resolve, 50));
  }

  handleLog(`Completed processing all ${allDateStrings.length} dates`);
  return heartbeatsByDate;
}

export async function handleWakApiImport(
  apiKey: string,
  instanceUrl: string,
  userId: string,
) {
  const job: ImportJob = {
    id: randomUUID(),
    fileName: `WakAPI Import ${new Date().toISOString()}`,
    status: "Pending",
    progress: 0,
    userId,
  };
  activeJobs.set(job.id, job);

  const headers = {
    Authorization: `Basic ${Buffer.from(apiKey).toString("base64")}`,
  };
  handleLog("Using headers:", {
    ...headers,
    Authorization: "Basic [REDACTED]",
  });

  const userIdentifier = "current";
  let baseUrl = instanceUrl.endsWith("/")
    ? instanceUrl.slice(0, -1)
    : instanceUrl;
  baseUrl = `${baseUrl}/api/compat/wakatime/v1`;

  job.status = "Processing";
  activeJobs.set(job.id, job);

  try {
    const allTimeUrl = `${baseUrl}/users/${userIdentifier}/all_time_since_today`;
    handleLog(`Requesting all-time summary from: ${allTimeUrl}`);

    const allTimeResponse = await $fetch<{
      data: { range: { start_date: string; end_date: string } };
    }>(allTimeUrl, { headers });

    if (!allTimeResponse?.data?.range) {
      const errorDetail = `Failed to fetch activity date range from WakAPI for user ${userId}. Response: ${JSON.stringify(allTimeResponse)}`;
      throw handleApiError(
        911,
        errorDetail,
        "Failed to fetch activity date range from WakAPI.",
      );
    }

    const startDate = new Date(allTimeResponse.data.range.start_date);
    const endDate = new Date();

    job.status = "Processing heartbeats";
    job.progress = 10;
    activeJobs.set(job.id, job);

    const heartbeatsByDate = await fetchWakApiHeartbeats(
      baseUrl,
      userIdentifier,
      headers,
      startDate,
      endDate,
      userId,
      job,
    );

    if (heartbeatsByDate.size === 0) {
      job.status = "Completed";
      job.progress = 100;
      activeJobs.set(job.id, job);
      return { success: true, message: "No data to import" };
    }

    job.status = "Completed";
    job.importedCount = Array.from(heartbeatsByDate.values()).reduce(
      (acc, val) => acc + val.length,
      0,
    );
    job.progress = 100;
    activeJobs.set(job.id, job);

    handleLog(
      `Successfully imported data from ${heartbeatsByDate.size} days with activity`,
    );
    return { success: true, imported: heartbeatsByDate.size };
  } catch (error: any) {
    job.status = "Failed";
    job.error = error instanceof Error ? error.message : String(error);
    activeJobs.set(job.id, job);

    throw handleApiError(
      911,
      `Failed to import activity data via WakAPI for user ${userId}: ${job.error}`,
      "Failed to import activity data. Please try again.",
    );
  }
}
