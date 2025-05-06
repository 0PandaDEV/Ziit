import path from 'path';
import { H3Event } from "h3";
import { z } from "zod";
import { processHeartbeatsByDate } from "~/server/utils/summarize";
import { createStandardError, handleApiError } from "~/server/utils/error";

interface WakApiUser {
  data: {
    username: string;
  };
}

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
      username: z.string(),
      display_name: z.string(),
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
  username: string,
  headers: any,
  startDate: Date,
  endDate: Date,
  userId: string
) {
  console.log(
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

  console.log(
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
      console.log(
        `Processing date ${i + 1}/${allDateStrings.length}: ${dateStr} (${Math.round(((i + 1) / allDateStrings.length) * 100)}% complete)`
      );
    }

    try {
      const heartbeatsUrl = `${baseUrl}/users/${username}/heartbeats`;
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
          console.log(`No heartbeats found for ${dateStr}`);
        }
        continue;
      }

      if (i % progressUpdateInterval === 0) {
        console.log(
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
      console.error(`Error fetching heartbeats for ${dateStr}:`, error);
    }

    await new Promise((resolve) => setTimeout(resolve, 50));
  }

  console.log(`Completed processing all ${allDateStrings.length} dates`);
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
    summariesId: null
  };
}

export default defineEventHandler(async (event: H3Event) => {
  const userId = event.context.user.id;
  console.log("Processing for user ID:", userId);

  const formData = await readMultipartFormData(event);
  if (!formData || formData.length === 0) {
    const body = await readBody(event);

    const validationResult = wakaApiRequestSchema.safeParse(body);
    if (!validationResult.success) {
      throw createStandardError(400, `Invalid request data: ${validationResult.error.message}`);
    }

    const { apiKey, instanceType, instanceUrl } = validationResult.data;
    console.log("Received request with:", {
      instanceType,
      instanceUrl: instanceUrl ? "provided" : "not provided",
    });

    if (instanceType === "wakatime") {
      throw createStandardError(400, "For WakaTime import, please export your data from WakaTime dashboard and upload the file");
    }

    if (instanceType === "wakapi" && !instanceUrl) {
      console.error("No instance URL provided for WakAPI");
      throw createStandardError(400, "Instance URL is required for WakAPI");
    }

    const headers = {
      Authorization: `Basic ${Buffer.from(apiKey).toString("base64")}`,
    };
    console.log("Using headers:", {
      ...headers,
      Authorization: "Basic [REDACTED]",
    });

    let username = "current";
    let baseUrl = instanceUrl!.endsWith("/")
      ? instanceUrl!.slice(0, -1)
      : instanceUrl!;
    baseUrl = `${baseUrl}/api/compat/wakatime/v1`;

    console.log("Fetching WakAPI user info from:", baseUrl);

    const userResponse = await $fetch<WakApiUser>(`${baseUrl}/users/current`, {
      headers,
    });

    if (!userResponse?.data?.username) {
      console.error("Failed to fetch user data from WakAPI");
      throw createStandardError(400, "Failed to fetch user data");
    }

    username = userResponse.data.username;
    console.log("Received WakAPI user info:", username);

    console.log("Fetching summary of all activity...");

    try {
      const allTimeUrl = `${baseUrl}/users/${username}/all_time_since_today`;
      console.log(`Requesting all-time summary from: ${allTimeUrl}`);

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

      console.log("Received all-time summary response");

      if (!allTimeResponse?.data?.range) {
        console.error("Invalid response from all_time_since_today endpoint");
        throw createStandardError(500, "Failed to fetch activity date range");
      }

      const startDate = new Date(allTimeResponse.data.range.start_date);
      const endDate = new Date();

      console.log(
        `Found activity range: ${startDate.toISOString()} to ${endDate.toISOString()}`
      );

      const heartbeatsByDate = await fetchRangeHeartbeats(
        baseUrl,
        username,
        headers,
        startDate,
        endDate,
        userId
      );

      if (heartbeatsByDate.size === 0) {
        console.log("No days with activity found");
        return { success: true, message: "No data to import" };
      }

      console.log(
        `Successfully imported data from ${heartbeatsByDate.size} days with activity`
      );
      return { success: true, imported: heartbeatsByDate.size };
    } catch (error) {
      return handleApiError(error, "Failed to import activity data");
    }
  }

  console.log("Processing WakaTime exported file upload");
  const fileData = formData.find(
    (item) => item.name === "file" && item.filename
  );

  if (!fileData || !fileData.data) {
    throw createStandardError(400, "No file uploaded or file content is missing");
  }

  try {
    const fileContent = new TextDecoder().decode(fileData.data);
    const parsedData = JSON.parse(fileContent);

    const validationResult = wakaTimeExportSchema.safeParse(parsedData);
    if (!validationResult.success) {
      throw createStandardError(400, `Invalid WakaTime export format: ${validationResult.error.message}`);
    }

    const wakaData = validationResult.data;

    console.log(
      `Parsing WakaTime export with ${wakaData.days.length} days of data`
    );

    let totalHeartbeats = 0;

    for (const day of wakaData.days) {
      if (!day.heartbeats || day.heartbeats.length === 0) continue;

      console.log(
        `Processing ${day.heartbeats.length} heartbeats for ${day.date}`
      );
      totalHeartbeats += day.heartbeats.length;

      try {
        const processedHeartbeats = day.heartbeats.map((h) => {
          return {
            userId,
            timestamp: BigInt(h.time * 1000),
            project: h.project || null,
            editor: h.user_agent_id ? extractEditor(h.user_agent_id) : null,
            language: h.language || null,
            os: h.entity ? extractOS(h.entity) : null,
            file: h.entity ? path.basename(h.entity) : null,
            branch: h.branch || null,
            createdAt: new Date(),
            summariesId: null
          };
        });

        await processHeartbeatsByDate(userId, processedHeartbeats);
      } catch (error) {
        console.error(`Error saving data for ${day.date}:`, error);
      }
    }

    console.log("Database update complete");
    return { success: true, imported: totalHeartbeats };
  } catch (error) {
    return handleApiError(error, "Failed to process uploaded file");
  }
});

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

  console.log("Failed to parse editor from:", userAgent);
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
