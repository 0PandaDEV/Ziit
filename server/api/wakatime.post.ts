import { PrismaClient } from "@prisma/client";
import { H3Event } from "h3";

const prisma = new PrismaClient();

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

export default defineEventHandler(async (event: H3Event) => {
  console.log("Starting WakaTime/WakAPI import process...");

  if (!event.context.user) {
    console.error("No authenticated user found");
    throw createError({
      statusCode: 401,
      message: "Unauthorized",
    });
  }

  const userId = event.context.user.id;
  console.log("Processing for user ID:", userId);

  const { apiKey, instanceType, instanceUrl } = await readBody(event);
  console.log("Received request with:", {
    instanceType,
    instanceUrl: instanceUrl ? "provided" : "not provided",
  });

  if (!apiKey) {
    console.error("No API key provided");
    throw createError({ statusCode: 400, message: "API key is required" });
  }

  if (!instanceType || !["wakatime", "wakapi"].includes(instanceType)) {
    console.error("Invalid instance type:", instanceType);
    throw createError({
      statusCode: 400,
      message: "Instance type must be either wakatime or wakapi",
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
  let baseUrl = "https://wakatime.com/api/v1";

  if (instanceType === "wakapi") {
    baseUrl = instanceUrl.endsWith("/")
      ? instanceUrl.slice(0, -1)
      : instanceUrl;
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
    const heartbeatsByDate = new Map<string, Array<any>>();

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
      const endDate = new Date(allTimeResponse.data.range.end_date);

      console.log(
        `Found activity range: ${allTimeResponse.data.range.start_date} to ${allTimeResponse.data.range.end_date}`
      );

      const allDateStrings: string[] = [];
      const currentDate = new Date(startDate);

      while (currentDate <= endDate) {
        allDateStrings.push(currentDate.toISOString().split("T")[0]);
        currentDate.setDate(currentDate.getDate() + 1);
      }

      console.log(
        `Generated ${allDateStrings.length} dates to check based on date range`
      );

      const BATCH_SIZE = 7;

      for (let i = 0; i < allDateStrings.length; i += BATCH_SIZE) {
        const dateBatch = allDateStrings.slice(i, i + BATCH_SIZE);
        console.log(
          `Processing batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(allDateStrings.length / BATCH_SIZE)}: ${dateBatch[0]} to ${dateBatch[dateBatch.length - 1]}`
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

            if (
              !heartbeatsResponse?.data ||
              heartbeatsResponse.data.length === 0
            ) {
              console.log(`No heartbeats found for ${dateStr}`);
              continue;
            }

            console.log(
              `Found ${heartbeatsResponse.data.length} heartbeats for ${dateStr}`
            );

            const heartbeats = heartbeatsResponse.data.map((h) => {
              let editor = null;
              let os = null;

              if (h.user_agent_id) {
                const userAgent = h.user_agent_id;

                const editorMatch = userAgent.match(
                  /vscode-wakatime\/(\d+\.\d+\.\d+)|cursor\/(\d+\.\d+\.\d+)/
                );
                if (editorMatch) {
                  const editorName = editorMatch[0].split("/")[0];
                  editor =
                    editorName.charAt(0).toUpperCase() + editorName.slice(1);
                }

                if (userAgent.includes("darwin")) {
                  os = "macOS";
                } else if (userAgent.includes("win")) {
                  os = "Windows";
                } else if (
                  userAgent.includes("linux") ||
                  userAgent.includes("ubuntu") ||
                  userAgent.includes("debian")
                ) {
                  os = "Linux";
                } else {
                  const osMatch = userAgent.match(/\((.*?)\)/);
                  if (osMatch && osMatch[1]) {
                    const osPart = osMatch[1].toLowerCase();
                    if (osPart.includes("win")) {
                      os = "Windows";
                    } else if (
                      osPart.includes("mac") ||
                      osPart.includes("darwin")
                    ) {
                      os = "macOS";
                    } else if (
                      osPart.includes("linux") ||
                      osPart.includes("ubuntu") ||
                      osPart.includes("debian")
                    ) {
                      os = "Linux";
                    }
                  }
                }
              }

              return {
                userId,
                timestamp: new Date(h.time * 1000),
                project: h.project || null,
                editor,
                language: h.language || null,
                os,
                file: h.entity || null,
                branch: h.branch || null,
              };
            });

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

      console.log(
        "Total heartbeats collected:",
        Array.from(heartbeatsByDate.values()).reduce(
          (acc, arr) => acc + arr.length,
          0
        )
      );

      if (heartbeatsByDate.size === 0) {
        console.log("No days with activity found");
        return { success: true, message: "No data to import" };
      }

      for (const [dateStr, heartbeats] of heartbeatsByDate.entries()) {
        if (heartbeats.length === 0) continue;

        try {
          const formattedDate = dateStr.split("T")[0];

          const summary = await prisma.summaries.upsert({
            where: {
              userId_date: {
                userId,
                date: new Date(formattedDate),
              },
            },
            update: {},
            create: {
              userId,
              date: new Date(formattedDate),
            },
          });

          console.log(
            `Created/updated summary for ${formattedDate} with ID ${summary.id}`
          );

          const heartbeatsWithSummaryId = heartbeats.map((heartbeat) => ({
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
              `Imported heartbeats ${i} to ${i + batch.length} for ${formattedDate}`
            );
          }
        } catch (error) {
          console.error(`Error saving data for ${dateStr}:`, error);
        }
      }
    } catch (error) {
      console.error("Error during import process:", error);
      throw createError({
        statusCode: 500,
        message: "Import process failed",
      });
    }
  }

  console.log("Database update complete");
  return { success: true };
});
