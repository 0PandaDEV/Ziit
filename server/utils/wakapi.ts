import path from "path";
import { parseUserAgent } from "./wakatime";
import { processHeartbeatsByDate } from "~~/server/utils/summarize";
import { handleApiError, handleLog } from "~~/server/utils/logging";
import { activeJobs, updateJob } from "~~/server/utils/import-queue";
import { randomUUID } from "crypto";
import { ImportJob, ImportStatus } from "~~/types/import";

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
      ? Math.round(heartbeat.time * 1000)
      : new Date().getTime(),
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
  userId: string
) {
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

  const heartbeatsByDate = new Map<string, any[]>();

  for (let i = 0; i < allDateStrings.length; i++) {
    const dateStr = allDateStrings[i];

    const heartbeatsUrl = `${baseUrl}/users/${userIdentifier}/heartbeats`;
    const heartbeatsResponse = await $fetch<{ data: WakApiHeartbeat[] }>(
      heartbeatsUrl,
      {
        params: { date: dateStr },
        headers,
      }
    );

    if (heartbeatsResponse?.data && heartbeatsResponse.data.length > 0) {
      const heartbeats = heartbeatsResponse.data.map((h) =>
        processWakaApiHeartbeat(h, userId)
      );

      heartbeatsByDate.set(dateStr, heartbeats);
    }
  }

  return heartbeatsByDate;
}

export async function prepareWakApiData(
  apiKey: string,
  instanceUrl: string,
  userId: string,
  job?: ImportJob
): Promise<Map<string, any[]>> {
  if (job) {
    updateJob(job, {
      status: ImportStatus.FetchingMetadata,
    });
  }

  const headers = {
    Authorization: `Basic ${Buffer.from(apiKey).toString("base64")}`,
  };

  const userIdentifier = "current";
  let baseUrl = instanceUrl.endsWith("/")
    ? instanceUrl.slice(0, -1)
    : instanceUrl;
  baseUrl = `${baseUrl}/api/compat/wakatime/v1`;

  const allTimeUrl = `${baseUrl}/users/${userIdentifier}/all_time_since_today`;

  const allTimeResponse = await $fetch<{
    data: { range: { start_date: string; end_date: string } };
  }>(allTimeUrl, { headers });

  if (!allTimeResponse?.data?.range) {
    throw new Error(
      `Failed to fetch activity date range from WakAPI for user ${userId}`
    );
  }

  const startDate = new Date(allTimeResponse.data.range.start_date);
  const endDate = new Date();

  if (job) {
    updateJob(job, {
      status: ImportStatus.Processing,
    });
  }

  const heartbeatsByDate = await fetchWakApiHeartbeats(
    baseUrl,
    userIdentifier,
    headers,
    startDate,
    endDate,
    userId
  );

  return heartbeatsByDate;
}

export async function handleWakApiSequentialImport(
  heartbeatsByDate: Map<string, any[]>,
  userId: string,
  job: ImportJob
): Promise<{ success: boolean; imported?: number; message?: string }> {
  try {
    handleLog(`[wakapi] Starting WakAPI sequential import for user ${userId}`);

    const datesWithData = Array.from(heartbeatsByDate.keys());
    handleLog(
      `[wakapi] Processing ${datesWithData.length} days of data sequentially`
    );

    updateJob(job, {
      status: ImportStatus.ProcessingHeartbeats,
      current: 0,
      total: datesWithData.length,
    });

    for (let i = 0; i < datesWithData.length; i++) {
      const dateStr = datesWithData[i];
      const heartbeats = heartbeatsByDate.get(dateStr);

      if (heartbeats && heartbeats.length > 0) {
        await processHeartbeatsByDate(userId, heartbeats);
      }

      updateJob(job, {
        status: ImportStatus.ProcessingHeartbeats,
        current: i + 1,
        total: datesWithData.length,
      });
    }

    updateJob(job, {
      status: ImportStatus.Completed,
      importedCount: datesWithData.length,
    });

    handleLog(
      `[wakapi] Successfully imported ${datesWithData.length} days from WakAPI`
    );

    return {
      success: true,
      imported: datesWithData.length,
      message: `Successfully imported ${datesWithData.length} days`,
    };
  } catch (error: any) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    updateJob(job, {
      status: ImportStatus.Failed,
      error: errorMessage,
    });

    handleLog(
      `[wakapi] WakAPI import failed for user ${userId}: ${errorMessage}`
    );

    throw handleApiError(
      69,
      `WakAPI import failed for user ${userId}: ${errorMessage}`,
      "Failed to import data from WakAPI. Please check your API key and try again."
    );
  }
}

export async function handleWakApiDateChunk(
  dates: string[],
  userId: string,
  heartbeatsByDate: Record<string, any[]>
): Promise<{ success: boolean; processed: number }> {
  try {
    let totalProcessed = 0;

    for (const dateStr of dates) {
      const heartbeats = heartbeatsByDate[dateStr];
      if (heartbeats && heartbeats.length > 0) {
        await processHeartbeatsByDate(userId, heartbeats);
        totalProcessed += heartbeats.length;
      }
    }

    return {
      success: true,
      processed: totalProcessed,
    };
  } catch (error) {
    handleLog(
      `[wakapi] Failed to process date chunk for user ${userId}: ${error}`
    );
    throw error;
  }
}

export async function handleWakApiImport(
  apiKey: string,
  instanceUrl: string,
  userId: string,
  existingJob?: ImportJob
): Promise<{ success: boolean; imported?: number; message?: string }> {
  const job: ImportJob = existingJob || {
    id: randomUUID(),
    fileName: `WakAPI Import ${new Date().toISOString()}`,
    status: ImportStatus.Processing,
    progress: 0,
    userId,
  };

  if (!existingJob) {
    activeJobs.set(job.id, job);
    updateJob(job, { status: ImportStatus.Processing });
  }

  try {
    handleLog(`[wakapi] Starting WakAPI import for user ${userId}`);

    updateJob(job, {
      status: ImportStatus.ProcessingHeartbeats,
      additionalInfo: "Authenticating with WakAPI instance",
    });

    handleLog("[wakapi] Fetching activity date range");
    const heartbeatsByDate = await prepareWakApiData(
      apiKey,
      instanceUrl,
      userId
    );

    return await handleWakApiSequentialImport(heartbeatsByDate, userId, job);
  } catch (error: any) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    updateJob(job, {
      status: ImportStatus.Failed,
      error: errorMessage,
    });

    handleLog(
      `[wakapi] WakAPI import failed for user ${userId}: ${errorMessage}`
    );

    throw handleApiError(
      69,
      `WakAPI import failed for user ${userId}: ${errorMessage}`,
      "Failed to import data from WakAPI. Please check your API key and try again."
    );
  }
}
