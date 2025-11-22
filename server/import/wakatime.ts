import { handleLog } from "~~/server/utils/logging";
import { updateJob } from "~~/server/utils/import-queue";
import { ImportJob, ImportStatus, QueueJob, ImportMethod } from "~~/types/import";
import { ImportProvider, ImportResult, ProcessedHeartbeat, ProcessJobHelpers, ChunkData } from "./types";
import { parseUserAgent, extractFileName, convertTimestamp } from "./helpers";

const enum Endpoints {
  WakatimeApiUrl = "https://api.wakatime.com/api/v1",
  WakatimeApiUserUrl = "/users/current",
  WakatimeApiAllTimeUrl = "/users/current/all_time_since_today",
  WakatimeApiHeartbeatsUrl = "/users/current/heartbeats",
  WakatimeApiHeartbeatsBulkUrl = "/users/current/heartbeats.bulk",
  WakatimeApiUserAgentsUrl = "/users/current/user_agents",
  WakatimeApiMachineNamesUrl = "/users/current/machine_names",
  WakatimeApiDataDumpUrl = "/users/current/data_dumps",
}

interface WakatimeHeartbeat {
  id: string;
  branch?: string;
  category?: string;
  entity?: string;
  is_write?: boolean;
  language?: string;
  project?: string;
  time: number;
  type?: string;
  user_agent_id?: string;
  machine_name_id?: string;
}

export interface WakatimeUserAgent {
  id: string;
  value: string;
  editor: string;
  os: string;
}

interface WakatimeDataDump {
  id: string;
  type: string;
  status: string;
  percent_complete: number;
  download_url?: string;
}

export interface WakatimeExportData {
  user: {
    username?: string | null;
    display_name?: string | null;
    last_plugin?: string;
  };
  range: {
    start: number;
    end: number;
  };
  days: Array<{
    date: string;
    heartbeats: WakatimeHeartbeat[];
  }>;
}

async function createDataDumpRequest(apiKey: string): Promise<void> {
  const url = `${Endpoints.WakatimeApiUrl}${Endpoints.WakatimeApiDataDumpUrl}`;

  try {
    await $fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(apiKey).toString("base64")}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        type: "heartbeats",
        email_when_finished: false,
      }),
    });
  } catch (error: any) {
    if (
      error.statusCode === 400 &&
      error.data?.error ===
        "Wait for your current export to expire before creating another."
    ) {
      return;
    }
    throw error;
  }
}

async function pollForDataDump(job: ImportJob | undefined, apiKey: string): Promise<WakatimeDataDump> {
  const url = `${Endpoints.WakatimeApiUrl}${Endpoints.WakatimeApiDataDumpUrl}`;
  const maxAttempts = 180;
  let attempts = 0;

  while (attempts < maxAttempts) {
    const response = await $fetch<{ data: WakatimeDataDump[] }>(url, {
      headers: {
        Authorization: `Basic ${Buffer.from(apiKey).toString("base64")}`,
      },
    });

    const heartbeatsDump = response.data.find(
      (dump) => dump.type === "heartbeats",
    );

    if (!heartbeatsDump) {
      throw new Error("No heartbeats dump found");
    }

    if (heartbeatsDump.status === "Completed" && heartbeatsDump.download_url) {
      return heartbeatsDump;
    }

    if (job) {
      updateJob(job, {
        status: ImportStatus.WaitingForDataDump,
        current: heartbeatsDump.percent_complete,
        total: 100
      })
    }

    await new Promise((resolve) => setTimeout(resolve, 10000));
    attempts++;
  }

  throw new Error("Data dump polling timed out after 10 minutes");
}

async function downloadDataDump(
  downloadUrl: string,
): Promise<WakatimeExportData> {
  const response = await fetch(downloadUrl);

  if (!response.body) {
    throw new Error("No response body found for download");
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let receivedBytes = 0;
  const PROGRESS_UPDATE_SIZE = 1024 * 1024;
  let nextProgressUpdate = PROGRESS_UPDATE_SIZE;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    if (value) {
      chunks.push(value);
      receivedBytes += value.length;

      if (receivedBytes >= nextProgressUpdate) {
        nextProgressUpdate += PROGRESS_UPDATE_SIZE;
      }
    }
  }

  const combined = new Uint8Array(receivedBytes);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.length;
  }

  const text = new TextDecoder().decode(combined);
  const exportData: WakatimeExportData = JSON.parse(text);

  return exportData;
}

async function fetchUserAgents(
  apiKey: string,
): Promise<Map<string, WakatimeUserAgent>> {
  const userAgents = new Map<string, WakatimeUserAgent>();
  let page = 1;
  let totalPages = 1;

  do {
    const url = `${Endpoints.WakatimeApiUrl}${Endpoints.WakatimeApiUserAgentsUrl}?page=${page}`;
    const response = await $fetch<{
      data: WakatimeUserAgent[];
      total_pages: number;
    }>(url, {
      headers: {
        Authorization: `Basic ${Buffer.from(apiKey).toString("base64")}`,
      },
    });

    response.data.forEach((ua) => {
      userAgents.set(ua.id, ua);
    });

    totalPages = response.total_pages;
    page++;
  } while (page <= totalPages);

  return userAgents;
}

export function mapHeartbeat(
  heartbeat: WakatimeHeartbeat,
  userAgents: Map<string, WakatimeUserAgent>,
  userId: string,
  lastPlugin?: string,
): ProcessedHeartbeat {
  const userAgent = userAgents.get(heartbeat.user_agent_id || "");

  let editor = userAgent?.editor || "unknown";
  let os = userAgent?.os || "unknown";

  if (!userAgent && heartbeat.user_agent_id) {
    const parsed = parseUserAgent(heartbeat.user_agent_id);
    editor = parsed.editor || editor;
    os = parsed.os || os;
  }

  if (!userAgent && lastPlugin) {
    const parsed = parseUserAgent(lastPlugin);
    if (parsed.editor) editor = parsed.editor;
    if (parsed.os) os = parsed.os;
  }

  return {
    userId,
    timestamp: convertTimestamp(heartbeat.time),
    project: heartbeat.project || null,
    editor,
    language: heartbeat.language || null,
    os,
    file: extractFileName(heartbeat.entity),
    branch: heartbeat.branch || null,
    createdAt: new Date(),
    summariesId: null,
  };
}

async function prepareWakatimeApiData(
  apiKey: string,
  job?: ImportJob,
): Promise<{
  exportData: WakatimeExportData;
  userAgents: Map<string, WakatimeUserAgent>;
}> {
  if (job) {
    updateJob(job, {
      status: ImportStatus.CreatingDataDumpRequest,
    });
  }
  await createDataDumpRequest(apiKey);

  if (job) {
    updateJob(job, {
      status: ImportStatus.WaitingForDataDump,
    });
  }
  const dataDump = await pollForDataDump(job, apiKey);

  if (job) {
    updateJob(job, {
      status: ImportStatus.Downloading,
    });
  }
  const exportData = await downloadDataDump(dataDump.download_url!);

  if (job) {
    updateJob(job, {
      status: ImportStatus.FetchingMetadata,
    });
  }
  const userAgents = await fetchUserAgents(apiKey);

  return { exportData, userAgents };
}

function prepareWakatimeFileData(exportData: WakatimeExportData): {
  daysWithHeartbeats: any[];
  useParallelProcessing: boolean;
} {
  if (!Array.isArray(exportData.days)) exportData.days = [];

  const daysWithHeartbeats = exportData.days.filter(
    (day) => day.heartbeats && day.heartbeats.length > 0,
  );

  const useParallelProcessing = daysWithHeartbeats.length > 10;

  return { daysWithHeartbeats, useParallelProcessing };
}

export const wakatimeApiProvider: ImportProvider = {
  name: ImportMethod.WAKATIME_API,
  config: {
    displayName: "WakaTime",
    logPrefix: "wakatime",
  },

  validateJob(data: QueueJob["data"]): void {
    if (!data.apiKey) {
      throw new Error("API key is required for WakaTime import");
    }
  },

  async processJob(
    job: QueueJob,
    importJob: ImportJob,
    helpers: ProcessJobHelpers
  ): Promise<ImportResult> {
    handleLog(`[${this.config.logPrefix}] Starting WakaTime API import for user ${job.userId}`);

    const { exportData } = await prepareWakatimeApiData(job.data.apiKey!, importJob);
    const { daysWithHeartbeats } = prepareWakatimeFileData(exportData);

    handleLog(`[${this.config.logPrefix}] Using parallel processing for ${daysWithHeartbeats.length} days`);

    importJob.totalToProcess = daysWithHeartbeats.length;
    importJob.data = {
      ...importJob.data,
      exportData,
    };
    helpers.activeJobs.set(job.id, importJob);

    helpers.createWorkChunks(job, daysWithHeartbeats, ImportMethod.WAKATIME_API);

    return {
      success: true,
      imported: 0,
      message: `Parallel processing initiated for ${daysWithHeartbeats.length} days`,
    };
  },

  async processChunk(chunkData: ChunkData, userId: string): Promise<{ processed: number }> {
    const { processHeartbeatsByDate } = await import("~~/server/utils/summarize");
    const { days } = chunkData;
    const userAgents = new Map<string, WakatimeUserAgent>();

    let totalProcessed = 0;

    for (const day of days || []) {
      if (!day.heartbeats || day.heartbeats.length === 0) continue;

      const processedHeartbeats = day.heartbeats.map((h: any) =>
        mapHeartbeat(h, userAgents, userId, chunkData.originalJob.data.exportData?.user.last_plugin)
      );

      await processHeartbeatsByDate(userId, processedHeartbeats);
      totalProcessed += processedHeartbeats.length;
    }

    return { processed: totalProcessed };
  },
};

export const wakatimeFileProvider: ImportProvider = {
  name: ImportMethod.WAKATIME_FILE,
  config: {
    displayName: "WakaTime",
    logPrefix: "wakatime",
  },

  validateJob(data: QueueJob["data"]): void {
    if (!data.exportData || !data.jobId) {
      throw new Error("Export data and job ID are required for WakaTime file import");
    }
  },

  async processJob(
    job: QueueJob,
    importJob: ImportJob,
    helpers: ProcessJobHelpers
  ): Promise<ImportResult> {
    const daysWithData = job.data.exportData!.days?.filter(
      (day: { heartbeats?: any[] }) => day.heartbeats && day.heartbeats.length > 0,
    ) || [];

    handleLog(`[${this.config.logPrefix}] Using parallel processing for ${daysWithData.length} days`);

    importJob.totalToProcess = daysWithData.length;
    helpers.activeJobs.set(job.id, importJob);

    helpers.createWorkChunks(job, daysWithData, ImportMethod.WAKATIME_FILE);

    return {
      success: true,
      imported: 0,
      message: `Parallel processing initiated for ${daysWithData.length} days`,
    };
  },

  async processChunk(chunkData: ChunkData, userId: string): Promise<{ processed: number }> {
    const { processHeartbeatsByDate } = await import("~~/server/utils/summarize");
    const { days } = chunkData;
    const userAgents = new Map<string, WakatimeUserAgent>();

    let totalProcessed = 0;

    for (const day of days || []) {
      if (!day.heartbeats || day.heartbeats.length === 0) continue;

      const processedHeartbeats = day.heartbeats.map((h: any) =>
        mapHeartbeat(h, userAgents, userId, chunkData.originalJob.data.exportData?.user.last_plugin)
      );

      await processHeartbeatsByDate(userId, processedHeartbeats);
      totalProcessed += processedHeartbeats.length;
    }

    return { processed: totalProcessed };
  },
};

