import { processHeartbeatsByDate } from "~~/server/utils/summarize";
import { handleApiError, handleLog } from "~~/server/utils/logging";
import { activeJobs, updateJob } from "~~/server/utils/import-queue";
import { randomUUID } from "crypto";
import path from "path";
import { ImportJob, ImportStatus } from "~~/types/import";

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
) {
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
    timestamp: new Date(Math.round(heartbeat.time * 1000)),
    project: heartbeat.project || null,
    editor,
    language: heartbeat.language || null,
    os,
    file: heartbeat.entity ? path.basename(heartbeat.entity) : null,
    branch: heartbeat.branch || null,
    createdAt: new Date(),
    summariesId: null,
  };
}

export async function prepareWakatimeApiData(
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

export async function handleWakatimeImport(
  apiKey: string,
  userId: string,
  existingJob?: ImportJob,
): Promise<{ success: boolean; imported: number; message?: string }> {
  const job: ImportJob = existingJob || {
    id: randomUUID(),
    fileName: `WakaTime Import ${new Date().toISOString()}`,
    status: ImportStatus.Processing,
    progress: 0,
    userId,
    type: "wakatime-api",
  };

  if (!existingJob) {
    activeJobs.set(job.id, job);
    updateJob(job, { status: ImportStatus.Processing });
  }

  try {
    handleLog(`[wakatime] Starting WakaTime API import for user ${userId}`);

    const { exportData, userAgents } = await prepareWakatimeApiData(
      apiKey,
      job,
    );
    const { daysWithHeartbeats } = prepareWakatimeFileData(exportData);

    handleLog(
      `[wakatime] Processing ${daysWithHeartbeats.length} days of data`,
    );

    updateJob(job, {
      status: ImportStatus.ProcessingHeartbeats,
      current: 0,
      total: daysWithHeartbeats.length,
    });

    for (let i = 0; i < daysWithHeartbeats.length; i++) {
      const day = daysWithHeartbeats[i];
      const processedHeartbeats = day.heartbeats.map((h: any) =>
        mapHeartbeat(h, userAgents, userId, exportData.user.last_plugin),
      );

      await processHeartbeatsByDate(userId, processedHeartbeats);

      updateJob(job, {
        status: ImportStatus.ProcessingHeartbeats,
        current: i + 1,
        total: daysWithHeartbeats.length,
      });
    }

    updateJob(job, {
      status: ImportStatus.Completed,
      importedCount: daysWithHeartbeats.length,
    });

    handleLog(
      `[wakatime] Successfully imported ${daysWithHeartbeats.length} days from WakaTime API`,
    );

    return {
      success: true,
      imported: daysWithHeartbeats.length,
      message: `Successfully imported ${daysWithHeartbeats.length} days`,
    };
  } catch (error: any) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    updateJob(job, {
      status: ImportStatus.Failed,
      error: errorMessage,
    });

    handleLog(
      `[wakatime] WakaTime API import failed for user ${userId}: ${errorMessage}`,
    );

    throw handleApiError(
      69,
      `WakaTime API import failed for user ${userId}: ${errorMessage}`,
      "Failed to import data from WakaTime. Please check your API key and try again.",
    );
  }
}

export function prepareWakatimeFileData(exportData: WakatimeExportData): {
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

export async function handleWakatimeFileImport(
  exportData: WakatimeExportData,
  userId: string,
  job: ImportJob,
): Promise<{ success: boolean; imported: number; message?: string }> {
  try {
    handleLog(`[wakatime] Starting WakaTime file import for user ${userId}`);

    const { daysWithHeartbeats, useParallelProcessing } =
      prepareWakatimeFileData(exportData);

    if (useParallelProcessing) {
      handleLog(
        `[wakatime] Using parallel processing for ${daysWithHeartbeats.length} days`,
      );

      return {
        success: true,
        imported: job.importedCount || 0,
        message: `Parallel processing initiated for ${daysWithHeartbeats.length} days`,
      };
    } else {
      handleLog(
        `[wakatime] Using sequential processing for ${daysWithHeartbeats.length} days`,
      );

      updateJob(job, {
        status: ImportStatus.ProcessingHeartbeats,
        current: 0,
        total: daysWithHeartbeats.length,
      });

      const userAgents = new Map<string, WakatimeUserAgent>();

      for (let i = 0; i < daysWithHeartbeats.length; i++) {
        const day = daysWithHeartbeats[i];
        const processedHeartbeats = day.heartbeats.map((h: any) =>
          mapHeartbeat(h, userAgents, userId, exportData.user.last_plugin),
        );

        await processHeartbeatsByDate(userId, processedHeartbeats);

        updateJob(job, {
          status: ImportStatus.ProcessingHeartbeats,
          current: i + 1,
          total: daysWithHeartbeats.length,
        });
      }

      updateJob(job, {
        status: ImportStatus.Completed,
        importedCount: daysWithHeartbeats.length,
      });

      handleLog(
        `[wakatime] Successfully imported ${daysWithHeartbeats.length} days from WakaTime file`,
      );

      return {
        success: true,
        imported: daysWithHeartbeats.length,
        message: `Successfully imported ${daysWithHeartbeats.length} days`,
      };
    }
  } catch (error: any) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    updateJob(job, {
      status: ImportStatus.Failed,
      error: errorMessage,
    });

    handleLog(
      `[wakatime] WakaTime file import failed for user ${userId}: ${errorMessage}`,
    );

    throw handleApiError(
      69,
      `WakaTime file import failed for user ${userId}: ${errorMessage}`,
      "Failed to import data from WakaTime file. Please check your file and try again.",
    );
  }
}

export function parseUserAgent(userAgent: string): {
  os: string;
  editor: string;
} {
  const editorCapitalization: Record<string, string> = {
    cursor: "Cursor",
    "visual studio code": "Visual Studio Code",
    vscode: "Visual Studio Code",
    "vs code": "Visual Studio Code",
    "sublime text": "Sublime Text",
    atom: "Atom",
    vim: "Vim",
    neovim: "NeoVim",
    nvim: "NeoVim",
    emacs: "Emacs",
    "zed dev": "Zed Preview",
    pearai: "PearAI",
    "intellij idea": "IntelliJ IDEA",
    "intellij community edition": "IntelliJ IDEA",
    "intellij ultimate edition": "IntelliJ IDEA",
    intellijidea: "IntelliJ IDEA",
    pycharm: "PyCharm",
    webstorm: "WebStorm",
    phpstorm: "PhpStorm",
    "android studio": "Android Studio",
    xcode: "Xcode",
  };

  const userAgentPattern = /\(([^)]+)\).*?go[\d.]+\s([A-Za-z ]+)\/[\d.]+/i;

  if (!userAgent) {
    return { os: "", editor: "" };
  }

  const match = userAgent.match(userAgentPattern);

  if (match && match.length >= 3) {
    let os: string = match[1];
    let editor: string = match[2];

    const editorLower = editor.toLowerCase();
    editor =
      editorCapitalization[editorLower] ||
      editor.replace(/\b\w/g, (l) => l.toUpperCase());

    if (os.includes("darwin")) {
      os = "macOS";
    } else if (os.includes("linux")) {
      os = "Linux";
    } else if (os.includes("windows") || os.includes("win")) {
      os = "Windows";
    } else {
      os = "Linux";
    }

    return { os, editor };
  }

  const browserMatch = userAgent.match(
    /(Firefox|Chrome|Edge|Safari|Opera)\/([\d.]+)/i,
  );
  const osMatch = userAgent.match(/\(([^)]+)\)/);

  if (browserMatch && browserMatch[1]) {
    let os = "Unknown";
    let editor = browserMatch[1];

    const editorLower = editor.toLowerCase();
    editor =
      editorCapitalization[editorLower] ||
      editor.replace(/\b\w/g, (l) => l.toUpperCase());

    if (osMatch && osMatch[1]) {
      const osInfo = osMatch[1].split(";")[0].trim();
      if (osInfo.startsWith("Windows")) {
        os = "Windows";
      } else if (osInfo.startsWith("Macintosh")) {
        os = "macOS";
      } else if (osInfo.startsWith("X11") || osInfo.startsWith("Linux")) {
        os = "Linux";
      } else {
        os = osInfo;
      }
    } else if (/windows/i.test(userAgent)) {
      os = "Windows";
    }

    return { os, editor };
  }

  return { os: "", editor: "" };
}
