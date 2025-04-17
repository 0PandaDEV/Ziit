import { PrismaClient } from "@prisma/client";
import { H3Event } from "h3";
import { z } from "zod";

const prisma = new PrismaClient();

function calculateTotalMinutesFromHeartbeats(
  heartbeats: any[],
  idleThresholdMinutes: number,
): number {
  if (heartbeats.length === 0) return 0;

  const sortedHeartbeats = [...heartbeats].sort(
    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
  );

  let totalMinutes = 0;
  let lastTimestamp: Date | null = null;
  const IDLE_THRESHOLD_MS = idleThresholdMinutes * 60 * 1000;

  for (const heartbeat of sortedHeartbeats) {
    const currentTimestamp = new Date(heartbeat.timestamp);

    if (lastTimestamp) {
      const timeDiff = currentTimestamp.getTime() - lastTimestamp.getTime();

      if (timeDiff < IDLE_THRESHOLD_MS) {
        totalMinutes += timeDiff / (60 * 1000);
      }
    }

    lastTimestamp = currentTimestamp;
  }

  return Math.round(totalMinutes);
}

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
          .passthrough(),
      ),
    }),
  ),
});

async function processHeartbeatsForDay(
  dateStr: string,
  heartbeats: any[],
  userId: string,
  userTimezone: string,
) {
  if (heartbeats.length === 0) return;

  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { keystrokeTimeout: true, timezone: true },
    });

    const idleThresholdMinutes = user?.keystrokeTimeout || 5;
    const timezone = user?.timezone || userTimezone || "UTC";

    const heartbeatsByDate = new Map<string, any[]>();

    heartbeats.forEach((heartbeat) => {
      const localDate = new Date(
        heartbeat.timestamp.toLocaleString("en-US", { timeZone: timezone }),
      );
      const dateKey = localDate.toISOString().split("T")[0];

      if (!heartbeatsByDate.has(dateKey)) {
        heartbeatsByDate.set(dateKey, []);
      }

      heartbeatsByDate.get(dateKey)!.push(heartbeat);
    });

    for (const [localDateStr, dateHeartbeats] of heartbeatsByDate.entries()) {
      const totalMinutes = calculateTotalMinutesFromHeartbeats(
        dateHeartbeats,
        idleThresholdMinutes,
      );

      const summary = await prisma.summaries.upsert({
        where: {
          userId_date: {
            userId,
            date: new Date(localDateStr),
          },
        },
        update: {},
        create: {
          userId,
          date: new Date(localDateStr),
          totalMinutes,
        },
      });

      console.log(
        `Created/updated summary for ${localDateStr} with ID ${summary.id}`,
      );

      const heartbeatsWithSummaryId = dateHeartbeats.map((heartbeat) => ({
        ...heartbeat,
        summariesId: summary.id,
      }));

      const BATCH_SIZE = 1000;
      for (let i = 0; i < heartbeatsWithSummaryId.length; i += BATCH_SIZE) {
        const batch = heartbeatsWithSummaryId.slice(i, i + BATCH_SIZE);
        await prisma.heartbeats.createMany({
          data: batch,
        });
        console.log(
          `Imported heartbeats ${i} to ${i + batch.length} for ${localDateStr}`,
        );
      }
    }
  } catch (error) {
    console.error(`Error saving data for ${dateStr}:`, error);
  }
}

async function fetchRangeHeartbeats(
  baseUrl: string,
  username: string,
  headers: any,
  startDate: Date,
  endDate: Date,
  userId: string,
) {
  console.log(
    `Fetching heartbeats from ${startDate.toISOString()} to ${endDate.toISOString()}`,
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
    `Generated ${allDateStrings.length} dates to check based on date range, including tomorrow to ensure all heartbeats are captured`,
  );

  const heartbeatsByDate = new Map<string, any[]>();
  const BATCH_SIZE = 7;

  for (let i = 0; i < allDateStrings.length; i += BATCH_SIZE) {
    const dateBatch = allDateStrings.slice(i, i + BATCH_SIZE);
    console.log(
      `Processing batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(allDateStrings.length / BATCH_SIZE)}: ${dateBatch[0]} to ${dateBatch[dateBatch.length - 1]}`,
    );

    for (const dateStr of dateBatch) {
      try {
        console.log(`Fetching heartbeats for ${dateStr}...`);

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
          console.log(`No heartbeats found for ${dateStr}`);
          continue;
        }

        console.log(
          `Found ${heartbeatsResponse.data.length} heartbeats for ${dateStr}`,
        );

        const heartbeats = heartbeatsResponse.data.map((h) =>
          processHeartbeat(h, userId),
        );

        if (heartbeats.length > 0) {
          heartbeatsByDate.set(dateStr, heartbeats);
        }
      } catch (error) {
        console.error(`Error fetching heartbeats for ${dateStr}:`, error);
      }

      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    if (i + BATCH_SIZE < allDateStrings.length) {
      console.log("Pausing between batches to avoid rate limits...");
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }

  return heartbeatsByDate;
}

function processHeartbeat(heartbeat: WakApiHeartbeat | any, userId: string) {
  let editor = null;
  let os = null;

  if (heartbeat.user_agent_id) {
    const userAgent = heartbeat.user_agent_id;

    const editorMatch = userAgent.match(
      /vscode-wakatime\/(\d+\.\d+\.\d+)|cursor\/(\d+\.\d+\.\d+)/,
    );
    if (editorMatch) {
      const editorName = editorMatch[0].split("/")[0];
      editor = editorName.charAt(0).toUpperCase() + editorName.slice(1);
    }
  }

  if (heartbeat.entity) {
    const filePath = heartbeat.entity;
    if (filePath.match(/^[A-Za-z]:[\\/]/) || filePath.match(/^\\\\/)) {
      os = "Windows";
    } else if (filePath.startsWith("/Users/")) {
      os = "macOS";
    } else if (filePath.startsWith("/home/")) {
      os = "Linux";
    }
  }

  return {
    userId: userId,
    timestamp: heartbeat.time
      ? new Date(heartbeat.time * 1000)
      : new Date(heartbeat.timestamp),
    project: heartbeat.project || null,
    editor,
    language: heartbeat.language || null,
    os,
    file: heartbeat.entity || null,
    branch: heartbeat.branch || null,
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
      throw createError({
        statusCode: 400,
        message: `Invalid request data: ${validationResult.error.message}`,
      });
    }

    const { apiKey, instanceType, instanceUrl } = validationResult.data;
    console.log("Received request with:", {
      instanceType,
      instanceUrl: instanceUrl ? "provided" : "not provided",
    });

    if (instanceType === "wakatime") {
      throw createError({
        statusCode: 400,
        message:
          "For WakaTime import, please export your data from WakaTime dashboard and upload the file",
      });
    }

    if (instanceType === "wakapi" && !instanceUrl) {
      console.error("No instance URL provided for WakAPI");
      throw createError({
        statusCode: 400,
        message: "Instance URL is required for WakAPI",
      });
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
      throw createError({
        statusCode: 400,
        message: "Failed to fetch user data",
      });
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
        throw createError({
          statusCode: 500,
          message: "Failed to fetch activity date range",
        });
      }

      const startDate = new Date(allTimeResponse.data.range.start_date);
      const endDate = new Date();

      console.log(
        `Found activity range: ${startDate.toISOString()} to ${endDate.toISOString()}`,
      );

      const heartbeatsByDate = await fetchRangeHeartbeats(
        baseUrl,
        username,
        headers,
        startDate,
        endDate,
        userId,
      );

      if (heartbeatsByDate.size === 0) {
        console.log("No days with activity found");
        return { success: true, message: "No data to import" };
      }

      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { timezone: true },
      });
      const userTimezone = user?.timezone || "UTC";

      for (const [dateStr, heartbeats] of heartbeatsByDate.entries()) {
        if (heartbeats.length === 0) continue;
        await processHeartbeatsForDay(
          dateStr,
          heartbeats,
          userId,
          userTimezone,
        );
      }
    } catch (error) {
      console.error("Error during import process:", error);
      throw createError({
        statusCode: 500,
        message: "Import process failed",
      });
    }

    return { success: true };
  }

  console.log("Processing WakaTime exported file upload");
  const fileData = formData.find(
    (item) => item.name === "file" && item.filename,
  );

  if (!fileData || !fileData.data) {
    throw createError({
      statusCode: 400,
      message: "No file uploaded or file content is missing",
    });
  }

  try {
    const fileContent = new TextDecoder().decode(fileData.data);
    const parsedData = JSON.parse(fileContent);

    const validationResult = wakaTimeExportSchema.safeParse(parsedData);
    if (!validationResult.success) {
      throw createError({
        statusCode: 400,
        message: `Invalid WakaTime export format: ${validationResult.error.message}`,
      });
    }

    const wakaData = validationResult.data;

    console.log(
      `Parsing WakaTime export with ${wakaData.days.length} days of data`,
    );

    let totalHeartbeats = 0;

    for (const day of wakaData.days) {
      if (!day.heartbeats || day.heartbeats.length === 0) continue;

      console.log(
        `Processing ${day.heartbeats.length} heartbeats for ${day.date}`,
      );
      totalHeartbeats += day.heartbeats.length;

      try {
        const user = await prisma.user.findUnique({
          where: { id: userId },
          select: { keystrokeTimeout: true, timezone: true },
        });

        const idleThresholdMinutes = user?.keystrokeTimeout || 5;
        const userTimezone = user?.timezone || "UTC";

        const processedHeartbeats = day.heartbeats.map((h) => {
          return {
            userId,
            timestamp: new Date(h.time * 1000),
            project: h.project || null,
            editor: h.user_agent_id ? extractEditor(h.user_agent_id) : null,
            language: h.language || null,
            os: h.entity ? extractOS(h.entity) : null,
            file: h.entity || null,
            branch: h.branch || null,
          };
        });

        const heartbeatsByDate = new Map<string, any[]>();

        processedHeartbeats.forEach((heartbeat) => {
          const localDate = new Date(
            heartbeat.timestamp.toLocaleString("en-US", {
              timeZone: userTimezone,
            }),
          );
          const dateKey = localDate.toISOString().split("T")[0];

          if (!heartbeatsByDate.has(dateKey)) {
            heartbeatsByDate.set(dateKey, []);
          }

          heartbeatsByDate.get(dateKey)!.push(heartbeat);
        });

        for (const [
          localDateStr,
          dateHeartbeats,
        ] of heartbeatsByDate.entries()) {
          await processDateHeartbeats(
            localDateStr,
            dateHeartbeats,
            userId,
            idleThresholdMinutes,
          );
        }
      } catch (error) {
        console.error(`Error saving data for ${day.date}:`, error);
      }
    }

    console.log("Database update complete");
    return { success: true, imported: totalHeartbeats };
  } catch (error) {
    console.error("Error processing uploaded file:", error);
    throw createError({
      statusCode: 500,
      message: "Failed to process uploaded file",
    });
  }
});

function extractEditor(userAgent: string): string | null {
  const editorMatch = userAgent.match(
    /vscode-wakatime\/(\d+\.\d+\.\d+)|cursor\/(\d+\.\d+\.\d+)/,
  );
  if (editorMatch) {
    const editorName = editorMatch[0].split("/")[0];
    return editorName.charAt(0).toUpperCase() + editorName.slice(1);
  }
  return null;
}

function extractOS(filePath: string): string | null {
  if (filePath.match(/^[A-Za-z]:[\\/]/) || filePath.match(/^\\\\/)) {
    return "Windows";
  } else if (filePath.startsWith("/Users/")) {
    return "macOS";
  } else if (filePath.startsWith("/home/")) {
    return "Linux";
  }
  return null;
}

async function processDateHeartbeats(
  dateStr: string,
  heartbeats: any[],
  userId: string,
  idleThresholdMinutes: number,
) {
  const totalMinutes = calculateTotalMinutesFromHeartbeats(
    heartbeats,
    idleThresholdMinutes,
  );

  const summary = await prisma.summaries.upsert({
    where: {
      userId_date: {
        userId,
        date: new Date(dateStr),
      },
    },
    update: {},
    create: {
      userId,
      date: new Date(dateStr),
      totalMinutes,
    },
  });

  console.log(`Created/updated summary for ${dateStr} with ID ${summary.id}`);

  const heartbeatsWithSummaryId = heartbeats.map((h) => ({
    ...h,
    summariesId: summary.id,
  }));

  const BATCH_SIZE = 1000;
  for (let i = 0; i < heartbeatsWithSummaryId.length; i += BATCH_SIZE) {
    const batch = heartbeatsWithSummaryId.slice(i, i + BATCH_SIZE);
    await prisma.heartbeats.createMany({
      data: batch,
    });
    console.log(
      `Imported heartbeats ${i} to ${i + batch.length} for ${dateStr}`,
    );
  }
}
