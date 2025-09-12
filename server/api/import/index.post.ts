import { H3Event } from "h3";
import z from "zod";
import { handleApiError, handleLog } from "~~/server/utils/logging";
import { handleWakApiImport } from "~~/server/utils/wakapi";
import {
  handleWakatimeImport,
  handleWakatimeFileImport,
} from "~~/server/utils/wakatime";
import { activeJobs, type ImportJob } from "~~/server/utils/import-jobs";
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
        "API key must be in format waka_<uuid>"
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
        })
      ),
    })
  ),
});

async function handleChunkUpload(formData: any[], userId: string) {
  const fileId = formData.find((p) => p.name === "fileId")?.data.toString();
  const chunkIndex = parseInt(
    formData.find((p) => p.name === "chunkIndex")?.data.toString() || "0"
  );
  const totalChunks = parseInt(
    formData.find((p) => p.name === "totalChunks")?.data.toString() || "0"
  );
  const fileName = formData.find((p) => p.name === "fileName")?.data.toString();
  const fileSize = parseInt(
    formData.find((p) => p.name === "fileSize")?.data.toString() || "0"
  );
  const chunk = formData.find((p) => p.name === "chunk");

  if (!fileId || !chunk || !fileName) {
    throw handleApiError(
      400,
      "Missing required fields for chunked upload",
      "Missing upload data"
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
    activeJobs.set(userId, job);
  }

  job.uploadedSize = (job.uploadedSize || 0) + chunk.data.length;
  job.progress = Math.round(((chunkIndex + 1) / totalChunks) * 100);
  activeJobs.set(userId, job);

  handleLog(
    `Received chunk ${chunkIndex + 1}/${totalChunks} for file ${fileId} for user ${userId}`
  );

  return { success: true, chunkIndex, totalChunks };
}

async function processFileInBackground(fileId: string, userId: string) {
  const job = activeJobs.get(userId);
  if (!job || job.fileId !== fileId) {
    throw handleApiError(
      404,
      `Job not found for file ID ${fileId}`,
      "Import job not found."
    );
  }

  job.status = "Processing";
  job.progress = 0;
  activeJobs.set(userId, job);

  const userTempDir = path.join(tmpdir(), "ziit-chunks", userId);
  const chunksDir = path.join(userTempDir, fileId);
  const combinedFilePath = path.join(userTempDir, `${fileId}-combined.json`);

  try {
    handleLog(
      `Starting background processing for user ${userId}, fileId ${fileId}`
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
      ).toFixed(2)} MB).`
    );

    const fileContent = new TextDecoder().decode(combinedContent);
    const parsedData = JSON.parse(fileContent);

    const validationResult = wakaTimeExportSchema.safeParse(parsedData);
    if (!validationResult.success) {
      throw new Error(
        `Invalid WakaTime export format: ${validationResult.error.message}`
      );
    }

    const wakaData = validationResult.data;
    handleLog(
      `Processing WakaTime export with ${wakaData.days.length} days of data`
    );

    const result = await handleWakatimeFileImport(
      wakaData as unknown as WakatimeExportData,
      userId,
      job
    );

    return result;
  } catch (error) {
    job.status = "Failed";
    job.error = error instanceof Error ? error.message : String(error);
    activeJobs.set(userId, job);
    handleLog(
      `Error processing file ${fileId}: ${error instanceof Error ? error.message : String(error)}`
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
        `Warning: Error during cleanup for user ${userId}: ${cleanupError}`
      );
    }
  }
}

export default defineEventHandler(async (event: H3Event) => {
  const userId = event.context.user.id;
  handleLog("Processing for user ID:", userId);

  const contentType = getHeader(event, "content-type") || "";

  if (contentType.includes("multipart/form-data")) {
    const formData = await readMultipartFormData(event);

    if (!formData || formData.length === 0) {
      throw handleApiError(
        400,
        "No form data received",
        "No form data received"
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
      (item) => item.name === "file" && item.filename
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
            "Invalid file format"
          );
        }

        const wakaData = validationResult.data;
        handleLog(
          `Processing WakaTime export with ${wakaData.days.length} days of data`
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
        activeJobs.set(userId, job);

        const result = await handleWakatimeFileImport(
          wakaData as unknown as WakatimeExportData,
          userId,
          job
        );
        return result;
      } catch (error: any) {
        if (error && typeof error === "object" && "__h3_error__" in error) {
          throw error;
        }
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        throw handleApiError(
          69,
          `Failed to process WakaTime file: ${errorMessage}`,
          "Failed to process uploaded file"
        );
      }
    }

    throw handleApiError(
      400,
      "Invalid form data",
      "Invalid form data received"
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
        `Error during background processing for user ${userId}: ${error}`
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
      validationResult.error.message || "Invalid API request data."
    );
  }

  const { instanceType, apiKey, instanceUrl } = validationResult.data;

  if (instanceType === "wakapi") {
    if (!instanceUrl) {
      throw handleApiError(
        400,
        "WakAPI instance URL missing",
        "WakAPI instance URL is missing"
      );
    }

    if (!apiKey) {
      throw handleApiError(
        400,
        "WakAPI API key missing",
        "API key is required"
      );
    }

    handleLog("Received WakAPI import request");
    return handleWakApiImport(apiKey, instanceUrl, userId);
  }

  if (instanceType === "wakatime") {
    if (!apiKey) {
      throw handleApiError(
        400,
        "WakaTime API key missing - use file upload instead",
        "WakaTime API key is required for API import. Use file upload as alternative."
      );
    }

    handleLog("Received WakaTime API import request");
    return handleWakatimeImport(apiKey, userId);
  }

  throw handleApiError(
    400,
    "Invalid instance type",
    "Invalid instance type specified"
  );
});
