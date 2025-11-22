import { processHeartbeatsByDate } from "~~/server/utils/summarize";
import { handleLog } from "~~/server/utils/logging";
import { updateJob } from "~~/server/utils/import-queue";
import { ImportJob, ImportStatus, QueueJob, ImportMethod } from "~~/types/import";
import { ImportProvider, ImportResult, ProcessedHeartbeat, ProcessJobHelpers, ChunkData } from "./types";
import { parseUserAgent, extractFileName } from "./helpers";

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

function processWakaApiHeartbeat(heartbeat: WakApiHeartbeat, userId: string): ProcessedHeartbeat {
  return {
    userId: userId,
    timestamp: heartbeat.time
      ? Math.round(heartbeat.time * 1000)
      : new Date().getTime(),
    project: heartbeat.project || null,
    editor: parseUserAgent(heartbeat.user_agent_id).editor,
    language: heartbeat.language || null,
    os: parseUserAgent(heartbeat.user_agent_id).os,
    file: extractFileName(heartbeat.entity),
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

async function prepareWakApiData(
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

export const wakapiProvider: ImportProvider = {
  name: ImportMethod.WAKAPI,
  config: {
    displayName: "WakAPI",
    logPrefix: "wakapi",
  },

  validateJob(data: QueueJob["data"]): void {
    if (!data.apiKey || !data.instanceUrl) {
      throw new Error("API key and instance URL are required for WakAPI import");
    }
  },

  async processJob(
    job: QueueJob,
    importJob: ImportJob,
    helpers: ProcessJobHelpers
  ): Promise<ImportResult> {
    const heartbeatsByDate = await prepareWakApiData(
      job.data.apiKey!,
      job.data.instanceUrl!,
      job.userId,
      importJob,
    );

    const datesWithData = Array.from(heartbeatsByDate.keys());

    handleLog(`[${this.config.logPrefix}] Using parallel processing for ${datesWithData.length} days`);

    importJob.totalToProcess = datesWithData.length;
    importJob.data = {
      heartbeatsByDate: Object.fromEntries(heartbeatsByDate),
      apiKey: job.data.apiKey,
      instanceUrl: job.data.instanceUrl,
    };
    helpers.activeJobs.set(job.id, importJob);

    helpers.createWorkChunks(job, datesWithData, ImportMethod.WAKAPI);

    return {
      success: true,
      imported: 0,
      message: `Parallel processing initiated for ${datesWithData.length} days`,
    };
  },

  async processChunk(chunkData: ChunkData, userId: string): Promise<{ processed: number }> {
    const { dates, heartbeatsByDate } = chunkData;

    let totalProcessed = 0;

    for (const dateStr of dates || []) {
      const heartbeats = heartbeatsByDate?.[dateStr];
      if (heartbeats && heartbeats.length > 0) {
        await processHeartbeatsByDate(userId, heartbeats);
        totalProcessed += heartbeats.length;
      }
    }

    return { processed: totalProcessed };
  },
};
