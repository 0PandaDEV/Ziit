import { processHeartbeatsByDate } from "~~/server/utils/summarize";
import { handleApiError, handleLog } from "~~/server/utils/logging";
import { activeJobs, type ImportJob } from "~~/server/utils/import-queue";
import path from "path";
import { randomUUID } from "crypto";

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

    handleLog("Data dump request created successfully");
  } catch (error: any) {
    if (
      error.statusCode === 400 &&
      error.data?.error ===
        "Wait for your current export to expire before creating another."
    ) {
      handleLog("Using existing data dump request");
      return;
    }
    throw error;
  }
}

async function pollForDataDump(
  apiKey: string,
  job?: ImportJob,
): Promise<WakatimeDataDump> {
  const url = `${Endpoints.WakatimeApiUrl}${Endpoints.WakatimeApiDataDumpUrl}`;
  const maxAttempts = 180;
  let attempts = 0;

  while (attempts < maxAttempts) {
    try {
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

      if (job) {
        job.status = "Processing";
        job.progress = Math.min(99, heartbeatsDump.percent_complete);
        activeJobs.set(job.id, job);
      }

      if (
        heartbeatsDump.status === "Completed" &&
        heartbeatsDump.download_url
      ) {
        handleLog(
          `Data dump ready for download: ${heartbeatsDump.percent_complete}% complete`,
        );
        if (job) {
          job.status = "Downloading";
          job.progress = 100;
          activeJobs.set(job.id, job);
        }
        return heartbeatsDump;
      }

      handleLog(
        `Data dump progress: ${heartbeatsDump.percent_complete}% complete`,
      );

      await new Promise((resolve) => setTimeout(resolve, 10000));
      attempts++;
    } catch (error) {
      handleLog(`Error polling for data dump: ${error}`);
      throw error;
    }
  }

  throw new Error("Data dump polling timed out after 10 minutes");
}

async function downloadDataDump(
  downloadUrl: string,
  job?: ImportJob,
): Promise<WakatimeExportData> {
  if (!job) throw new Error("Job is required for progress tracking");

  job.status = "Downloading";
  job.progress = 0;
  activeJobs.set(job.id, job);

  try {
    const response = await fetch(downloadUrl);

    if (!response.body) {
      throw new Error("No response body found for download");
    }

    const contentLengthHeader = response.headers.get("Content-Length");
    const totalBytes = contentLengthHeader
      ? parseInt(contentLengthHeader, 10)
      : NaN;

    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let receivedBytes = 0;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      if (value) {
        chunks.push(value);
      }

      receivedBytes += value?.length || 0;

      if (!isNaN(totalBytes)) {
        job.progress = Math.min(
          99,
          Math.round((receivedBytes / totalBytes) * 100),
        );
        activeJobs.set(job.id, job);
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

    handleLog(
      `Downloaded data dump with ${Array.isArray(exportData.days) ? exportData.days.length : 0} days of data`,
    );

    job.progress = 100;
    activeJobs.set(job.id, job);

    return exportData;
  } catch (error) {
    job.status = "Failed";
    job.error = error instanceof Error ? error.message : String(error);
    activeJobs.set(job.id, job);

    handleLog(`Error downloading data dump: ${error}`);
    throw error;
  }
}

async function fetchUserAgents(
  apiKey: string,
): Promise<Map<string, WakatimeUserAgent>> {
  const userAgents = new Map<string, WakatimeUserAgent>();
  let page = 1;
  let totalPages = 1;

  do {
    try {
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
    } catch (error) {
      handleLog(`Error fetching user agents page ${page}: ${error}`);
      break;
    }
  } while (page <= totalPages);

  handleLog(`Fetched ${userAgents.size} user agents`);
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
    timestamp: BigInt(Math.round(heartbeat.time * 1000)),
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

export async function handleWakatimeImport(
  apiKey: string,
  userId: string,
): Promise<{ success: boolean; imported: number; message?: string }> {
  const job: ImportJob = {
    id: randomUUID(),
    fileName: `WakaTime Import ${new Date().toISOString()}`,
    status: "Pending",
    progress: 0,
    userId,
  };
  activeJobs.set(job.id, job);

  try {
    handleLog(`Starting WakaTime API import for user ${userId}`);

    handleLog("Creating data dump request...");
    job.status = "Creating data dump request";
    job.progress = 5;
    activeJobs.set(job.id, job);

    await createDataDumpRequest(apiKey);

    job.status = "Waiting for data dump";
    job.progress = 10;
    activeJobs.set(job.id, job);

    handleLog("Waiting for data dump to be ready...");
    const dataDump = await pollForDataDump(apiKey, job);

    handleLog("Downloading data dump...");
    const exportData = await downloadDataDump(dataDump.download_url!, job);

    job.status = "Fetching metadata";
    job.progress = 0;
    activeJobs.set(job.id, job);

    handleLog("Fetching user agents and machine names...");
    const userAgents = await fetchUserAgents(apiKey);

    if (!Array.isArray(exportData.days)) exportData.days = [];

    job.totalToProcess = exportData.days.length;
    job.status = "Processing heartbeats";
    job.processedCount = 0;
    job.progress = 0;
    activeJobs.set(job.id, job);

    const importResults: number[] = [];
    for (const day of exportData.days) {
      if (!day.heartbeats || day.heartbeats.length === 0) {
        importResults.push(0);
        job.processedCount! += 1;
        job.progress = Math.round(
          (job.processedCount! / exportData.days.length) * 100,
        );
        activeJobs.set(job.id, job);
        continue;
      }

      handleLog(
        `Processing ${day.heartbeats.length} heartbeats for ${day.date}`,
      );

      const processedHeartbeats = day.heartbeats.map((h) =>
        mapHeartbeat(h, userAgents, userId, exportData.user.last_plugin),
      );

      try {
        await processHeartbeatsByDate(userId, processedHeartbeats);

        job.processedCount! += 1;
        job.progress = Math.round(
          (job.processedCount! / exportData.days.length) * 100,
        );
        activeJobs.set(job.id, job);

        importResults.push(processedHeartbeats.length);
      } catch (error) {
        handleLog(`Error processing heartbeats for ${day.date}: ${error}`);

        job.processedCount! += 1;
        job.progress = Math.round(
          (job.processedCount! / exportData.days.length) * 100,
        );
        activeJobs.set(job.id, job);

        importResults.push(0);
      }
    }

    const totalHeartbeats = importResults.reduce((acc, val) => acc + val, 0);

    job.status = "Completed";
    job.importedCount = totalHeartbeats;
    job.progress = 100;
    activeJobs.set(job.id, job);

    handleLog(
      `Successfully imported ${totalHeartbeats} heartbeats from WakaTime`,
    );

    return {
      success: true,
      imported: totalHeartbeats,
      message: `Successfully imported ${totalHeartbeats} heartbeats`,
    };
  } catch (error: any) {
    job.status = "Failed";
    const errorMessage = error instanceof Error ? error.message : String(error);
    job.error = errorMessage;
    activeJobs.set(job.id, job);

    handleLog(`WakaTime API import failed for user ${userId}: ${errorMessage}`);

    throw handleApiError(
      911,
      `WakaTime API import failed for user ${userId}: ${errorMessage}`,
      "Failed to import data from WakaTime. Please check your API key and try again.",
    );
  }
}

export async function handleWakatimeFileImport(
  exportData: WakatimeExportData,
  userId: string,
  job: ImportJob,
): Promise<{ success: boolean; imported: number; message?: string }> {
  try {
    handleLog(`Starting WakaTime file import for user ${userId}`);

    job.status = "Processing";
    activeJobs.set(job.id, job);

    if (!Array.isArray(exportData.days)) exportData.days = [];

    job.totalToProcess = exportData.days.length;
    job.status = "Processing heartbeats";
    job.processedCount = 0;
    job.progress = 0;
    activeJobs.set(job.id, job);

    const importResults: number[] = [];
    for (const day of exportData.days) {
      if (!day.heartbeats || day.heartbeats.length === 0) {
        importResults.push(0);
        job.processedCount! += 1;
        job.progress = Math.round(
          (job.processedCount! / exportData.days.length) * 100,
        );
        activeJobs.set(job.id, job);
        continue;
      }

      handleLog(
        `Processing ${day.heartbeats.length} heartbeats for ${day.date}`,
      );

      const userAgents = new Map<string, WakatimeUserAgent>();

      const processedHeartbeats = day.heartbeats.map((h) =>
        mapHeartbeat(h, userAgents, userId, exportData.user.last_plugin),
      );

      try {
        await processHeartbeatsByDate(userId, processedHeartbeats);

        job.processedCount! += 1;
        job.progress = Math.round(
          (job.processedCount! / exportData.days.length) * 100,
        );
        activeJobs.set(job.id, job);

        importResults.push(processedHeartbeats.length);
      } catch (error) {
        handleLog(`Error processing heartbeats for ${day.date}: ${error}`);

        job.processedCount! += 1;
        job.progress = Math.round(
          (job.processedCount! / exportData.days.length) * 100,
        );
        activeJobs.set(job.id, job);

        importResults.push(0);
      }
    }

    const totalHeartbeats = importResults.reduce((acc, val) => acc + val, 0);

    job.status = "Completed";
    job.importedCount = totalHeartbeats;
    job.progress = 100;
    activeJobs.set(job.id, job);

    handleLog(
      `Successfully imported ${totalHeartbeats} heartbeats from WakaTime file`,
    );

    return {
      success: true,
      imported: totalHeartbeats,
      message: `Successfully imported ${totalHeartbeats} heartbeats`,
    };
  } catch (error: any) {
    job.status = "Failed";
    const errorMessage = error instanceof Error ? error.message : String(error);
    job.error = errorMessage;
    activeJobs.set(job.id, job);

    handleLog(
      `WakaTime file import failed for user ${userId}: ${errorMessage}`,
    );

    throw handleApiError(
      911,
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
    "sublime text": "Sublime Text",
    atom: "Atom",
    vim: "Vim",
    neovim: "NeoVim",
    nvim: "NeoVim",
    emacs: "Emacs",
    "zed dev": "Zed Preview",
    pearai: "PearAI",
    "intellij idea": "IntelliJ IDEA",
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
