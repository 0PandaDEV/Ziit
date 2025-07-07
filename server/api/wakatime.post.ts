import path from "path";
import fs from "fs";
import { mkdirSync, writeFileSync, existsSync } from "fs";
import { tmpdir } from "os";
import { H3Event } from "h3";
import { z } from "zod";
import { processHeartbeatsByDate } from "~/server/utils/summarize";
import { handleApiError, handleLog } from "~/server/utils/logging";

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

const wakaApiRequestSchema = z.object({
  apiKey: z.string().min(1, "API key is required"),
  instanceType: z.enum(["wakapi", "wakatime"]),
  instanceUrl: z.string().url().optional(),
});

const wakaTimeExportSchema = z.object({
  user: z
    .object({
      username: z.string().nullable().optional(),
      display_name: z.string().nullable().optional(),
    })
    .passthrough(),
  range: z.object({
    start: z.number(),
    end: z.number(),
  }),
  days: z.array(
    z.object({
      date: z.string(),
      heartbeats: z.array(
        z
          .object({
            branch: z.string().optional().nullable(),
            entity: z.string().optional().nullable(),
            time: z.number(),
            language: z.string().optional().nullable(),
            project: z.string().optional().nullable(),
            user_agent_id: z.string().optional().nullable(),
          })
          .passthrough()
      ),
    })
  ),
});

async function fetchRangeHeartbeats(
  baseUrl: string,
  userIdentifier: string,
  headers: any,
  startDate: Date,
  endDate: Date,
  userId: string
) {
  handleLog(
    `Fetching heartbeats from ${startDate.toISOString()} to ${endDate.toISOString()}`
  );

  const today = new Date();
  const adjustedEndDate = new Date();
  adjustedEndDate.setHours(23, 59, 59, 999);

  if (endDate < adjustedEndDate) {
    endDate = adjustedEndDate;
  }

  const allDateStrings: string[] = [];
  const currentDate = new Date(startDate);

  while (currentDate <= endDate) {
    allDateStrings.push(currentDate.toISOString().split("T")[0]);
    currentDate.setDate(currentDate.getDate() + 1);
  }

  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowStr = tomorrow.toISOString().split("T")[0];

  if (!allDateStrings.includes(tomorrowStr)) {
    allDateStrings.push(tomorrowStr);
  }

  handleLog(
    `Generated ${allDateStrings.length} dates to check based on date range, including tomorrow to ensure all heartbeats are captured`
  );

  const heartbeatsByDate = new Map<string, any[]>();
  const progressUpdateInterval = Math.max(
    1,
    Math.floor(allDateStrings.length / 10)
  );

  for (let i = 0; i < allDateStrings.length; i++) {
    const dateStr = allDateStrings[i];

    if (i % progressUpdateInterval === 0 || i === allDateStrings.length - 1) {
      handleLog(
        `Processing date ${i + 1}/${allDateStrings.length}: ${dateStr} (${Math.round(((i + 1) / allDateStrings.length) * 100)}% complete)`
      );
    }

    try {
      const heartbeatsUrl = `${baseUrl}/users/${userIdentifier}/heartbeats`;
      const heartbeatsResponse = await $fetch<{
        data: WakApiHeartbeat[];
      }>(heartbeatsUrl, {
        params: {
          date: dateStr,
        },
        headers,
      });

      if (!heartbeatsResponse?.data || heartbeatsResponse.data.length === 0) {
        if (i % progressUpdateInterval === 0) {
          handleLog(`No heartbeats found for ${dateStr}`);
        }
        continue;
      }

      if (i % progressUpdateInterval === 0) {
        handleLog(
          `Found ${heartbeatsResponse.data.length} heartbeats for ${dateStr}`
        );
      }

      const heartbeats = heartbeatsResponse.data.map((h) =>
        processHeartbeat(h, userId)
      );

      if (heartbeats.length > 0) {
        heartbeatsByDate.set(dateStr, heartbeats);
        await processHeartbeatsByDate(userId, heartbeats);
      }
    } catch (error) {
      handleApiError(
        500,
        `Error fetching heartbeats for ${dateStr} for user ${userId}: ${error instanceof Error ? error.message : String(error)}`,
        "An error occurred while fetching some activity data. The import may be incomplete."
      );
    }

    await new Promise((resolve) => setTimeout(resolve, 50));
  }

  handleLog(`Completed processing all ${allDateStrings.length} dates`);
  return heartbeatsByDate;
}

function processHeartbeat(heartbeat: WakApiHeartbeat | any, userId: string) {
  return {
    userId: userId,
    timestamp: heartbeat.time
      ? BigInt(heartbeat.time * 1000)
      : BigInt(new Date(heartbeat.timestamp).getTime()),
    project: heartbeat.project || null,
    editor: heartbeat.user_agent_id
      ? extractEditor(heartbeat.user_agent_id)
      : null,
    language: heartbeat.language || null,
    os: heartbeat.user_agent_id
      ? extractOS(heartbeat.user_agent_id)
      : extractOS(heartbeat.entity || ""),
    file: heartbeat.entity ? path.basename(heartbeat.entity) : null,
    branch: heartbeat.branch || null,
    createdAt: new Date(),
    summariesId: null,
  };
}

export default defineEventHandler(async (event: H3Event) => {
  const userId = event.context.user.id;
  handleLog("Processing for user ID:", userId);

  const formData = await readMultipartFormData(event);

  if (
    formData &&
    formData.some((item) => item.name === "fileId") &&
    formData.some((item) => item.name === "chunkIndex") &&
    formData.some((item) => item.name === "chunk")
  ) {
    handleLog("Detected chunk upload");
    return handleChunkUpload(formData, userId);
  }

  if (!formData || formData.length === 0) {
    const body = await readBody(event);

    if (body && body.fileId && body.processChunks) {
      return handleProcessChunks(body.fileId, userId);
    }

    const validationResult = wakaApiRequestSchema.safeParse(body);
    if (!validationResult.success) {
      const errorDetail = `Invalid WakaTime API request data for user ${userId}: ${validationResult.error.errors[0].message}`;
      throw handleApiError(
        400,
        errorDetail,
        validationResult.error.errors[0].message || "Invalid API request data."
      );
    }

    const { apiKey, instanceType, instanceUrl } = validationResult.data;
    handleLog("Received request with:", {
      instanceType,
      instanceUrl: instanceUrl ? "provided" : "not provided",
    });

    if (instanceType === "wakatime") {
      const errorDetail = `WakaTime import attempt via API for user ${userId}, but file upload is required.`;
      throw handleApiError(
        400,
        errorDetail,
        "File upload is required for WakaTime import."
      );
    }

    if (instanceType === "wakapi" && !instanceUrl) {
      const errorDetail = `WakAPI instance URL missing for user ${userId}.`;
      throw handleApiError(400, errorDetail, "WakAPI instance URL is missing.");
    }

    const headers = {
      Authorization: `Basic ${Buffer.from(apiKey).toString("base64")}`,
    };
    handleLog("Using headers:", {
      ...headers,
      Authorization: "Basic [REDACTED]",
    });

    const userIdentifier = "current";
    let baseUrl = instanceUrl!.endsWith("/")
      ? instanceUrl!.slice(0, -1)
      : instanceUrl!;
    baseUrl = `${baseUrl}/api/compat/wakatime/v1`;

    handleLog("Using WakAPI with baseUrl:", baseUrl);

    try {
      const allTimeUrl = `${baseUrl}/users/${userIdentifier}/all_time_since_today`;
      handleLog(`Requesting all-time summary from: ${allTimeUrl}`);

      const allTimeResponse = await $fetch<{
        data: {
          range: {
            start_date: string;
            end_date: string;
          };
        };
      }>(allTimeUrl, {
        headers,
      });

      handleLog("Received all-time summary response");

      if (!allTimeResponse?.data?.range) {
        const errorDetail = `Failed to fetch activity date range from WakAPI for user ${userId}. Response: ${JSON.stringify(allTimeResponse)}`;
        throw handleApiError(
          500,
          errorDetail,
          "Failed to fetch activity date range from WakAPI."
        );
      }

      const startDate = new Date(allTimeResponse.data.range.start_date);
      const endDate = new Date();

      handleLog(
        `Found activity range: ${startDate.toISOString()} to ${endDate.toISOString()}`
      );

      const heartbeatsByDate = await fetchRangeHeartbeats(
        baseUrl,
        userIdentifier,
        headers,
        startDate,
        endDate,
        userId
      );

      if (heartbeatsByDate.size === 0) {
        handleLog("No days with activity found");
        return { success: true, message: "No data to import" };
      }

      handleLog(
        `Successfully imported data from ${heartbeatsByDate.size} days with activity`
      );
      return { success: true, imported: heartbeatsByDate.size };
    } catch (error: any) {
      if (error && typeof error === "object" && "__h3_error__" in error) {
        throw error;
      }
      const detailedMessage =
        error instanceof Error
          ? error.message
          : "Unknown error during WakAPI import.";
      throw handleApiError(
        500,
        `Failed to import activity data via WakAPI for user ${userId}: ${detailedMessage}`,
        "Failed to import activity data. Please try again."
      );
    }
  }

  handleLog("Processing WakaTime exported file upload");
  const fileData = formData.find(
    (item) => item.name === "file" && item.filename
  );

  if (!fileData || !fileData.data) {
    const errorDetail = `No file uploaded or file content is missing for WakaTime import by user ${userId}.`;
    throw handleApiError(
      400,
      errorDetail,
      "No file uploaded or file content is missing."
    );
  }

  try {
    const fileContent = new TextDecoder().decode(fileData.data);
    const parsedData = JSON.parse(fileContent);

    const validationResult = wakaTimeExportSchema.safeParse(parsedData);
    if (!validationResult.success) {
      const errorDetail = `Invalid WakaTime export format for user ${userId}: ${validationResult.error.errors[0].message}`;
      throw handleApiError(
        400,
        errorDetail,
        validationResult.error.errors[0].message || "Invalid file format."
      );
    }

    const wakaData = validationResult.data;

    handleLog(
      `Parsing WakaTime export with ${wakaData.days.length} days of data`
    );

    let totalHeartbeats = 0;

    for (const day of wakaData.days) {
      if (!day.heartbeats || day.heartbeats.length === 0) continue;

      handleLog(
        `Processing ${day.heartbeats.length} heartbeats for ${day.date}`
      );
      totalHeartbeats += day.heartbeats.length;

      try {
        const processedHeartbeats = day.heartbeats.map((h) => {
          return {
            userId,
            timestamp: BigInt(Math.floor(h.time * 1000)),
            project: h.project || null,
            editor: h.user_agent_id ? extractEditor(h.user_agent_id) : null,
            language: h.language || null,
            os: h.entity ? extractOS(h.entity) : null,
            file: h.entity ? path.basename(h.entity) : null,
            branch: h.branch || null,
            createdAt: new Date(),
            summariesId: null,
          };
        });

        await processHeartbeatsByDate(userId, processedHeartbeats);
      } catch (error) {
        handleApiError(
          500,
          `Error processing or saving heartbeats for date ${day.date} during WakaTime export for user ${userId}: ${error instanceof Error ? error.message : String(error)}`,
          "An error occurred while processing a day's data from the WakaTime export. The import may be incomplete."
        );
      }
    }

    handleLog("Database update complete");
    return { success: true, imported: totalHeartbeats };
  } catch (error: any) {
    if (error && typeof error === "object" && "__h3_error__" in error) {
      throw error;
    }
    const detailedMessage =
      error instanceof Error
        ? error.message
        : "Unknown error during WakaTime file import.";
    throw handleApiError(
      500,
      `Failed to process uploaded WakaTime file for user ${userId}: ${detailedMessage}`,
      "Failed to process uploaded file. Please try again."
    );
  }
});

async function handleChunkUpload(formData: any[], userId: string) {
  try {
    const fileIdItem = formData.find((item) => item.name === "fileId");
    const chunkIndexItem = formData.find((item) => item.name === "chunkIndex");
    const totalChunksItem = formData.find(
      (item) => item.name === "totalChunks"
    );
    const fileNameItem = formData.find((item) => item.name === "fileName");
    const chunkItem = formData.find((item) => item.name === "chunk");

    if (
      !fileIdItem?.data ||
      !chunkIndexItem?.data ||
      !totalChunksItem?.data ||
      !fileNameItem?.data ||
      !chunkItem?.data
    ) {
      const missingFields = [];
      if (!fileIdItem?.data) missingFields.push("fileId");
      if (!chunkIndexItem?.data) missingFields.push("chunkIndex");
      if (!totalChunksItem?.data) missingFields.push("totalChunks");
      if (!fileNameItem?.data) missingFields.push("fileName");
      if (!chunkItem?.data) missingFields.push("chunk");

      const errorMessage = `Missing required chunk information: ${missingFields.join(", ")}`;
      handleLog(errorMessage);
      throw handleApiError(400, errorMessage, "Invalid chunk data");
    }

    const fileId = new TextDecoder().decode(fileIdItem.data);
    const chunkIndex = parseInt(new TextDecoder().decode(chunkIndexItem.data));
    const totalChunks = parseInt(
      new TextDecoder().decode(totalChunksItem.data)
    );
    const fileName = new TextDecoder().decode(fileNameItem.data);

    const userTempDir = path.join(tmpdir(), "ziit-chunks", userId);
    const chunksDir = path.join(userTempDir, fileId);

    if (!existsSync(userTempDir)) {
      mkdirSync(userTempDir, { recursive: true });
    }

    if (!existsSync(chunksDir)) {
      mkdirSync(chunksDir, { recursive: true });
    }

    const chunkPath = path.join(chunksDir, `chunk-${chunkIndex}`);
    writeFileSync(chunkPath, chunkItem.data);

    handleLog(
      `Saved chunk ${chunkIndex + 1}/${totalChunks} for file ${fileName} (user ${userId})`
    );

    if (chunkIndex === totalChunks - 1) {
      return handleProcessChunks(fileId, userId);
    }

    return {
      success: true,
      message: `Chunk ${chunkIndex + 1} of ${totalChunks} received successfully`,
      chunkIndex,
      totalChunks,
    };
  } catch (error: any) {
    if (error && typeof error === "object" && "__h3_error__" in error) {
      throw error;
    }

    const detailedMessage =
      error instanceof Error ? error.message : "Unknown error processing chunk";
    throw handleApiError(
      500,
      `Failed to process chunk for user ${userId}: ${detailedMessage}`,
      "Failed to process file chunk"
    );
  }
}

async function handleProcessChunks(fileId: string, userId: string) {
  try {
    const userTempDir = path.join(tmpdir(), "ziit-chunks", userId);
    const chunksDir = path.join(userTempDir, fileId);

    handleLog(`Processing chunks from directory: ${chunksDir}`);

    if (!existsSync(chunksDir)) {
      handleLog(`ERROR: Chunks directory does not exist: ${chunksDir}`);
      throw handleApiError(
        404,
        `Chunks directory not found for file ID ${fileId}`,
        "Upload chunks not found"
      );
    }

    const chunkFiles = fs
      .readdirSync(chunksDir)
      .filter((file) => file.startsWith("chunk-"))
      .sort((a, b) => {
        const indexA = parseInt(a.split("-")[1]);
        const indexB = parseInt(b.split("-")[1]);
        return indexA - indexB;
      });

    handleLog(`Found ${chunkFiles.length} chunk files`);

    const combinedFilePath = path.join(userTempDir, `${fileId}-combined.json`);
    handleLog(`Will create combined file at: ${combinedFilePath}`);

    let combinedContent = Buffer.alloc(0);

    for (const chunkFile of chunkFiles) {
      const chunkPath = path.join(chunksDir, chunkFile);
      handleLog(`Reading chunk file: ${chunkPath}`);

      if (!existsSync(chunkPath)) {
        handleLog(`ERROR: Chunk file does not exist: ${chunkPath}`);
        throw new Error(`Chunk file not found: ${chunkPath}`);
      }

      const chunkData = fs.readFileSync(chunkPath);
      handleLog(
        `Read chunk file: ${chunkPath}, size: ${chunkData.length} bytes`
      );

      combinedContent = Buffer.concat([combinedContent, chunkData]);
    }

    fs.writeFileSync(combinedFilePath, combinedContent);
    handleLog(`Wrote combined file with size: ${combinedContent.length} bytes`);

    handleLog(`Verifying combined file exists at: ${combinedFilePath}`);
    if (!existsSync(combinedFilePath)) {
      handleLog(`ERROR: Combined file does not exist: ${combinedFilePath}`);
      throw new Error(`Combined file not found: ${combinedFilePath}`);
    }

    handleLog(`Processing combined file for user ${userId}`);
    const fileContent = fs.readFileSync(combinedFilePath, "utf-8");
    handleLog(`Read combined file, size: ${fileContent.length} bytes`);

    const parsedData = JSON.parse(fileContent);

    const validationResult = wakaTimeExportSchema.safeParse(parsedData);
    if (!validationResult.success) {
      const errorDetail = `Invalid WakaTime export format for user ${userId}: ${validationResult.error.errors[0].message}`;
      throw handleApiError(
        400,
        errorDetail,
        validationResult.error.errors[0].message || "Invalid file format."
      );
    }

    const wakaData = validationResult.data;

    handleLog(
      `Parsing WakaTime export with ${wakaData.days.length} days of data`
    );

    let totalHeartbeats = 0;

    for (const day of wakaData.days) {
      if (!day.heartbeats || day.heartbeats.length === 0) continue;

      handleLog(
        `Processing ${day.heartbeats.length} heartbeats for ${day.date}`
      );
      totalHeartbeats += day.heartbeats.length;

      try {
        const processedHeartbeats = day.heartbeats.map((h) => {
          return {
            userId,
            timestamp: BigInt(Math.floor(h.time * 1000)),
            project: h.project || null,
            editor: h.user_agent_id ? extractEditor(h.user_agent_id) : null,
            language: h.language || null,
            os: h.entity ? extractOS(h.entity) : null,
            file: h.entity ? path.basename(h.entity) : null,
            branch: h.branch || null,
            createdAt: new Date(),
            summariesId: null,
          };
        });

        await processHeartbeatsByDate(userId, processedHeartbeats);
      } catch (error) {
        handleApiError(
          500,
          `Error processing or saving heartbeats for date ${day.date} during WakaTime export for user ${userId}: ${error instanceof Error ? error.message : String(error)}`,
          "An error occurred while processing a day's data from the WakaTime export. The import may be incomplete."
        );
      }
    }

    try {
      fs.unlinkSync(combinedFilePath);
      for (const chunkFile of chunkFiles) {
        fs.unlinkSync(path.join(chunksDir, chunkFile));
      }
      fs.rmdirSync(chunksDir);
    } catch (cleanupError) {
      handleLog(`Warning: Error during cleanup: ${cleanupError}`);
    }

    handleLog("Database update complete");
    return { success: true, imported: totalHeartbeats };
  } catch (error: any) {
    if (error && typeof error === "object" && "__h3_error__" in error) {
      throw error;
    }

    const detailedMessage =
      error instanceof Error
        ? error.message
        : "Unknown error processing chunks";
    throw handleApiError(
      500,
      `Failed to process chunked file for user ${userId}: ${detailedMessage}`,
      "Failed to process uploaded file chunks"
    );
  }
}

function extractEditor(userAgent: string) {
  if (!userAgent) {
    return "No user Agent";
  }

  if (userAgent.includes("cursor/")) return "Cursor";
  if (userAgent.includes("vscode/") && !userAgent.includes("cursor/"))
    return "VS Code";
  if (userAgent.includes("intellijidea/")) return "IntelliJ IDEA";
  if (
    userAgent.includes("Zed/") ||
    userAgent.includes("Zed Preview/") ||
    userAgent.includes("Zed Dev/")
  )
    return "Zed";
  if (userAgent.includes("pearai/")) return "Pear AI";
  if (userAgent.includes("trae/")) return "Trae";

  const lowerUserAgent = userAgent.toLowerCase();
  if (lowerUserAgent.includes("goland")) return "GoLand";
  if (lowerUserAgent.includes("emacs")) return "emacs";
  if (lowerUserAgent.includes("kate")) return "kate";
  if (lowerUserAgent.includes("neovim")) return "neovim";
  if (lowerUserAgent.includes("skype")) return "Skype";
  if (lowerUserAgent.includes("notepad++")) return "Notepad++";
  if (lowerUserAgent.includes("hbuilder x")) return "HBuilder X";

  if (userAgent.includes("vscode-wakatime")) return "VS Code";
  if (userAgent.includes("intellijidea-wakatime")) return "IntelliJ IDEA";
  if (userAgent.includes("Zed-wakatime")) return "Zed";

  if (userAgent.includes("Unknown/")) return "Unknown";

  return null;
}

function extractOS(path: string): string | null {
  if (!path) return null;

  const osRegex = /\(([a-z]+(?:-[a-z]+)?)-[\d.]+(?:-[a-z0-9_]+)?\)/i;
  const osMatch = path.match(osRegex);

  if (osMatch && osMatch[1]) {
    const os = osMatch[1].toLowerCase();
    if (os === "darwin" || os.startsWith("darwin-")) return "macOS";
    if (os === "windows" || os.startsWith("windows-")) return "Windows";
    if (os === "linux" || os.startsWith("linux-")) return "Linux";
  }

  const lowerPath = path.toLowerCase();

  if (
    lowerPath.includes("linux") ||
    lowerPath.includes("wsl") ||
    lowerPath.match(/linux-[\d.]+/) ||
    lowerPath.includes("-x86_64") ||
    lowerPath.includes("ubuntu") ||
    lowerPath.includes("debian") ||
    lowerPath.includes("fedora") ||
    lowerPath.includes("arch") ||
    lowerPath.includes("centos") ||
    lowerPath.includes("redhat") ||
    lowerPath.includes("mint") ||
    lowerPath.includes("kali") ||
    (lowerPath.includes("gnu") && !lowerPath.includes("darwin"))
  ) {
    return "Linux";
  }

  if (
    lowerPath.includes("win_") ||
    lowerPath.includes("windows") ||
    lowerPath.includes("windows_nt") ||
    lowerPath.match(/windows-[\d.]+/) ||
    lowerPath.includes("win32") ||
    lowerPath.includes("win64") ||
    lowerPath.includes("winnt") ||
    lowerPath.includes("mswin") ||
    lowerPath.includes("cygwin") ||
    lowerPath.includes("mingw")
  ) {
    return "Windows";
  }

  if (
    lowerPath.includes("mac_") ||
    lowerPath.includes("mac") ||
    lowerPath.includes("darwin") ||
    lowerPath.includes("osx") ||
    lowerPath.includes("mac_arm64") ||
    lowerPath.includes("mac_x86-64") ||
    lowerPath.includes("macos") ||
    lowerPath.includes("apple") ||
    lowerPath.includes("macintosh") ||
    lowerPath.includes("ios")
  ) {
    return "macOS";
  }

  if (
    path.match(/^[A-Za-z]:[\\/]/) ||
    path.match(/^\\\\/) ||
    path.includes("\\")
  ) {
    return "Windows";
  } else if (path.startsWith("/Users/")) {
    return "macOS";
  } else if (path.startsWith("/home/")) {
    return "Linux";
  }

  if (path.includes("go1.") && path.includes("wakatime/")) {
    if (path.includes("arm64") || path.includes("darwin")) {
      return "macOS";
    }
    if (path.includes("x86_64") || path.includes("x86-64")) {
      if (path.includes("windows")) {
        return "Windows";
      }

      return "Linux";
    }
  }

  return null;
}
