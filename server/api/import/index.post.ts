import { H3Event } from "h3";
import z from "zod";
import { handleApiError, handleLog } from "~~/server/utils/logging";
import {
  activeJobs,
  type ImportJob,
  queueWakApiImport,
  queueWakatimeApiImport,
  queueWakatimeFileImport,
  getQueueStatus,
  getAllJobStatuses,
} from "~~/server/utils/import-queue";
import { randomUUID } from "crypto";
import path from "path";
import { mkdirSync, writeFileSync, existsSync, rmSync } from "fs";
import { tmpdir } from "os";
import fs from "fs";
import type { WakatimeExportData } from "~~/server/utils/wakatime";

export const requestSchema = z.discriminatedUnion("instanceType", [
  z.object({
    instanceType: z.literal("wakapi"),
    apiKey: z.uuid("API key must be a valid UUID"),
    instanceUrl: z.url("Instance URL must be valid").optional(),
  }),
  z.object({
    instanceType: z.literal("wakatime"),
    apiKey: z
      .string()
      .regex(
        /^waka_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
        "API key must be in format waka_<uuid>",
      )
      .optional(),
    instanceUrl: z.string().optional(),
  }),
]);

const wakaTimeExportSchema = z.object({
  user: z.object({
    username: z.string().nullable().optional(),
    display_name: z.string().nullable().optional(),
    last_plugin: z.string().optional(),
  }),
  range: z.object({
    start: z.number(),
    end: z.number(),
  }),
  days: z.array(
    z.object({
      date: z.string(),
      heartbeats: z.array(
        z.object({
          branch: z.string().optional().nullable(),
          entity: z.string().optional().nullable(),
          time: z.number(),
          language: z.string().optional().nullable(),
          project: z.string().optional().nullable(),
          user_agent_id: z.string().optional().nullable(),
        }),
      ),
    }),
  ),
});

async function handleChunkUpload(formData: any[], userId: string) {
  const fileId = formData.find((p) => p.name === "fileId")?.data.toString();
  const chunkIndex = parseInt(
    formData.find((p) => p.name === "chunkIndex")?.data.toString() || "0",
  );
  const totalChunks = parseInt(
    formData.find((p) => p.name === "totalChunks")?.data.toString() || "0",
  );
  const fileName = formData.find((p) => p.name === "fileName")?.data.toString();
  const fileSize = parseInt(
    formData.find((p) => p.name === "fileSize")?.data.toString() || "0",
  );
  const chunk = formData.find((p) => p.name === "chunk");

  if (!fileId || !chunk || !fileName) {
    throw handleApiError(
      400,
      "Missing required fields for chunked upload",
      "Missing upload data",
    );
  }

  const userTempDir = path.join(tmpdir(), "ziit-chunks", userId);
  const chunksDir = path.join(userTempDir, fileId);
  mkdirSync(chunksDir, { recursive: true });

  const chunkPath = path.join(chunksDir, `chunk-${chunkIndex}`);
  writeFileSync(chunkPath, chunk.data);

  let job = activeJobs.get(userId);
  if (!job) {
    job = {
      id: fileId,
      fileName,
      status: "Uploading",
      progress: 0,
      userId,
      totalSize: fileSize,
      uploadedSize: 0,
      fileId: fileId,
    } as ImportJob;
    activeJobs.set(fileId, job);
  }

  const previousUploadedSize = job.uploadedSize || 0;
  const newUploadedSize = previousUploadedSize + chunk.data.length;
  job.uploadedSize = newUploadedSize;
  job.progress = Math.round((newUploadedSize / fileSize) * 100);
  activeJobs.set(fileId, job);

  const previousMB = Math.floor(previousUploadedSize / (1024 * 1024));
  const currentMB = Math.floor(newUploadedSize / (1024 * 1024));
  if (currentMB > previousMB) {
    handleLog(
      `Uploaded ${currentMB}MB of ${Math.ceil(fileSize / (1024 * 1024))}MB for file ${fileId}`,
    );
  }

  handleLog(
    `Received chunk ${chunkIndex + 1}/${totalChunks} for file ${fileId} (${(newUploadedSize / (1024 * 1024)).toFixed(2)}MB/${(fileSize / (1024 * 1024)).toFixed(2)}MB)`,
  );

  return { success: true, chunkIndex, totalChunks };
}

async function processFileInBackground(fileId: string, userId: string) {
  const job = activeJobs.get(fileId);
  if (!job || job.fileId !== fileId) {
    throw handleApiError(
      404,
      `Job not found for file ID ${fileId}`,
      "Import job not found.",
    );
  }

  job.status = "Processing";
  job.progress = 0;
  activeJobs.set(fileId, job);

  const userTempDir = path.join(tmpdir(), "ziit-chunks", userId);
  const chunksDir = path.join(userTempDir, fileId);
  const combinedFilePath = path.join(userTempDir, `${fileId}-combined.json`);

  try {
    handleLog(
      `Starting background processing for user ${userId}, fileId ${fileId}`,
    );

    if (!existsSync(chunksDir)) {
      throw new Error(`Chunks directory does not exist: ${chunksDir}`);
    }

    const chunkFiles = fs
      .readdirSync(chunksDir)
      .filter((file) => file.startsWith("chunk-"))
      .sort((a, b) => {
        const indexA = parseInt(a.split("-")[1]);
        const indexB = parseInt(b.split("-")[1]);
        return indexA - indexB;
      });

    let combinedContent = Buffer.alloc(0);
    for (const chunkFile of chunkFiles) {
      const chunkPath = path.join(chunksDir, chunkFile);
      if (!existsSync(chunkPath)) {
        throw new Error(`Chunk file not found: ${chunkPath}`);
      }
      const chunkData = fs.readFileSync(chunkPath);
      combinedContent = Buffer.concat([combinedContent, chunkData]);
    }
    fs.writeFileSync(combinedFilePath, combinedContent);
    handleLog(
      `Combined ${chunkFiles.length} chunks for file ${fileId} (${(
        combinedContent.length /
        (1024 * 1024)
      ).toFixed(2)} MB).`,
    );

    const fileContent = new TextDecoder().decode(combinedContent);
    const parsedData = JSON.parse(fileContent);

    const validationResult = wakaTimeExportSchema.safeParse(parsedData);
    if (!validationResult.success) {
      throw new Error(
        `Invalid WakaTime export format: ${validationResult.error.message}`,
      );
    }

    const wakaData = validationResult.data;
    const daysWithData = wakaData.days.filter(
      (day) => day.heartbeats && day.heartbeats.length > 0,
    );
    handleLog(
      `Processing WakaTime export with ${daysWithData.length} days of data (${wakaData.days.length} total days in file)`,
    );

    const queueJobId = queueWakatimeFileImport(
      wakaData as unknown as WakatimeExportData,
      userId,
      fileId,
    );

    return {
      success: true,
      jobId: queueJobId,
      message: "File import has been queued for processing",
    };
  } catch (error) {
    job.status = "Failed";
    job.error = error instanceof Error ? error.message : String(error);
    activeJobs.set(fileId, job);
    handleLog(
      `Error processing file ${fileId}: ${error instanceof Error ? error.message : String(error)}`,
    );
    throw error;
  } finally {
    try {
      if (existsSync(combinedFilePath)) {
        fs.unlinkSync(combinedFilePath);
      }
      if (existsSync(chunksDir)) {
        rmSync(chunksDir, { recursive: true, force: true });
      }
    } catch (cleanupError) {
      handleLog(
        `Warning: Error during cleanup for user ${userId}: ${cleanupError}`,
      );
    }
  }
}

export default defineEventHandler(async (event: H3Event) => {
  const userId = event.context.user.id;

  if (event.method === "GET") {
    const queueStatus = getQueueStatus();
    const userJobs = getAllJobStatuses(userId);

    return {
      success: true,
      queue: queueStatus,
      userJobs: userJobs.slice(0, 10),
      hasActiveJobs: userJobs.some((job) =>
        ["Processing", "Queued", "Uploading", "Pending"].includes(job.status),
      ),
    };
  }

  const contentType = getHeader(event, "content-type") || "";

  if (contentType.includes("multipart/form-data")) {
    const formData = await readMultipartFormData(event);

    if (!formData || formData.length === 0) {
      throw handleApiError(
        400,
        "No form data received",
        "No form data received",
      );
    }

    if (
      formData.some((item) => item.name === "fileId") &&
      formData.some((item) => item.name === "chunkIndex") &&
      formData.some((item) => item.name === "chunk")
    ) {
      handleLog("Detected chunk upload");
      return handleChunkUpload(formData, userId);
    }

    const fileData = formData.find(
      (item) => item.name === "file" && item.filename,
    );

    if (fileData && fileData.data) {
      handleLog("Processing WakaTime exported file upload");

      try {
        const fileContent = new TextDecoder().decode(fileData.data);
        const parsedData = JSON.parse(fileContent);

        const validationResult = wakaTimeExportSchema.safeParse(parsedData);
        if (!validationResult.success) {
          throw handleApiError(
            400,
            `Invalid WakaTime export format: ${validationResult.error.message}`,
            "Invalid file format",
          );
        }

        const wakaData = validationResult.data;
        const daysWithData = wakaData.days.filter(
          (day) => day.heartbeats && day.heartbeats.length > 0,
        );
        handleLog(
          `Processing WakaTime export with ${daysWithData.length} days of data (${wakaData.days.length} total days in file)`,
        );

        const jobId = randomUUID();
        const job: ImportJob = {
          id: jobId,
          fileName:
            fileData.filename || `WakaTime Import ${new Date().toISOString()}`,
          status: "Processing",
          progress: 0,
          userId,
        };
        activeJobs.set(jobId, job);

        const queueJobId = queueWakatimeFileImport(
          wakaData as unknown as WakatimeExportData,
          userId,
          jobId,
        );

        return {
          success: true,
          jobId: queueJobId,
          message: "File import has been queued for processing",
        };
      } catch (error: any) {
        if (error && typeof error === "object" && "__h3_error__" in error) {
          throw error;
        }
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        throw handleApiError(
          69,
          `Failed to process WakaTime file: ${errorMessage}`,
          "Failed to process uploaded file",
        );
      }
    }

    throw handleApiError(
      400,
      "Invalid form data",
      "Invalid form data received",
    );
  }

  const body = await readBody(event);

  if (!body || !body.processChunks) {
    for (const [jobId, job] of activeJobs.entries()) {
      if (job.userId === userId) {
        activeJobs.delete(jobId);
      }
    }
  }

  if (body && body.fileId && body.processChunks) {
    handleLog("Processing chunks request");

    processFileInBackground(body.fileId, userId).catch((error) => {
      handleLog(
        `Error during background processing for user ${userId}: ${error}`,
      );
    });

    return {
      success: true,
      message: "File processing has started in the background.",
    };
  }

  const validationResult = requestSchema.safeParse(body);

  if (!validationResult.success) {
    throw handleApiError(
      400,
      `Invalid request data for user ${userId}: ${validationResult.error.message}`,
      validationResult.error.message || "Invalid API request data.",
    );
  }

  const { instanceType, apiKey, instanceUrl } = validationResult.data;

  if (instanceType === "wakapi") {
    if (!instanceUrl) {
      throw handleApiError(
        400,
        "WakAPI instance URL missing",
        "WakAPI instance URL is missing",
      );
    }

    if (!apiKey) {
      throw handleApiError(
        400,
        "WakAPI API key missing",
        "API key is required",
      );
    }

    handleLog("Received WakAPI import request");
    const jobId = queueWakApiImport(apiKey, instanceUrl, userId);
    return {
      success: true,
      jobId,
      message: "WakAPI import has been queued for processing",
    };
  }

  if (instanceType === "wakatime") {
    if (!apiKey) {
      throw handleApiError(
        400,
        "WakaTime API key missing - use file upload instead",
        "WakaTime API key is required for API import. Use file upload as alternative.",
      );
    }

    handleLog("Received WakaTime API import request");
    const jobId = queueWakatimeApiImport(apiKey, userId);
    return {
      success: true,
      jobId,
      message: "WakaTime API import has been queued for processing",
    };
  }

  throw handleApiError(
    400,
    "Invalid instance type",
    "Invalid instance type specified",
  );
});
