import { H3Event } from "h3";
import z from "zod";
import { handleApiError, handleLog } from "~~/server/utils/logging";
import {
  activeJobs,
  queueImport,
  getQueueStatus,
  getAllJobStatuses,
  updateJob,
} from "~~/server/utils/import-queue";
import { randomUUID } from "crypto";
import path from "path";
import { mkdirSync, writeFileSync, existsSync, rmSync } from "fs";
import { tmpdir } from "os";
import fs from "fs";
import busboy from "busboy";
import { ImportJob, ImportStatus, ImportMethod } from "~~/types/import";
import { WakatimeExportData } from "~~/server/import/wakatime";
import { parseCodetimeCSV } from "~~/server/import/codetime";
import { getProvider } from "~~/server/import/types";

async function safeReadMultipartFormData(event: H3Event): Promise<any[]> {
  const contentLength = getHeader(event, "content-length");
  const contentType = getHeader(event, "content-type") || "";

  if (contentLength) {
    const size = parseInt(contentLength);
    const MAX_SIZE = 2 * 1024 * 1024 * 1024; // 2GB

    if (size > MAX_SIZE) {
      throw handleApiError(
        413,
        `File too large: ${size} bytes (max: ${MAX_SIZE} bytes)`,
        "File size exceeds maximum allowed limit"
      );
    }
    if (size < 0 || !Number.isFinite(size)) {
      throw handleApiError(
        400,
        `Invalid content-length header: ${contentLength}`,
        "Invalid file size"
      );
    }
  }

  return new Promise((resolve, reject) => {
    const fields: any[] = [];
    const maxFileSize = 500 * 1024 * 1024;
    const maxFieldSize = 1024 * 1024;

    try {
      const bb = busboy({
        headers: {
          "content-type": contentType,
        },
        limits: {
          fileSize: maxFileSize,
          fieldSize: maxFieldSize,
          files: 10,
          fields: 100,
        },
      });

      bb.on("file", (fieldname: string, file: any, info: any) => {
        const { filename, encoding, mimeType } = info;
        const chunks: Buffer[] = [];
        let totalSize = 0;

        file.on("data", (chunk: Buffer) => {
          totalSize += chunk.length;

          if (fieldname === "chunk") {
            const getFieldVal = (name: string) => {
              const f = fields.find(
                (x) => x.type === "field" && x.name === name
              );
              return f ? f.data.toString() : undefined;
            };

            const fileId = getFieldVal("fileId");
            const fileSizeStr = getFieldVal("fileSize");
            const fileSize = fileSizeStr ? parseInt(fileSizeStr) : 0;

            if (fileId && fileSize > 0) {
              const MB = 1024 * 1024;
              let job = activeJobs.get(fileId);
              if (!job) {
                job = {
                  id: fileId,
                  fileName: getFieldVal("fileName") || filename,
                  status: ImportStatus.Processing,
                  progress: 0,
                  userId: (event as any).context.user?.id || "",
                  type: ImportMethod.WAKATIME_FILE,
                  totalSize: fileSize,
                  uploadedSize: 0,
                  fileId,
                } as ImportJob;
                activeJobs.set(fileId, job);

                updateJob(job, {
                  status: ImportStatus.Uploading,
                  current: job.uploadedSize || 0,
                  total: fileSize,
                });
              }

              const streamedKey = "__streamedInCurrentChunk__";
              // @ts-ignore
              job[streamedKey] = (job as any)[streamedKey] || 0;
              // @ts-ignore
              (job as any)[streamedKey] += chunk.length;

              // @ts-ignore
              const currentUploaded = Math.min(
                fileSize,
                (job.uploadedSize || 0) + (job as any)[streamedKey]
              );

              const lastMBKey = "__lastEmittedMB__";
              // @ts-ignore
              let lastEmittedMB =
                (job as any)[lastMBKey] ??
                Math.floor(Math.min(job.uploadedSize || 0, fileSize) / MB);
              const currentMB = Math.floor(currentUploaded / MB);

              while (currentMB > lastEmittedMB) {
                const emitBytes = Math.min(
                  (lastEmittedMB + 1) * MB,
                  currentUploaded
                );
                updateJob(job, {
                  status: ImportStatus.Uploading,
                  current: emitBytes,
                  total: fileSize,
                });
                lastEmittedMB++;
              }
              // @ts-ignore
              job[lastMBKey] = lastEmittedMB;
            }
          }

          chunks.push(chunk);
        });

        file.on("end", () => {
          const data = Buffer.concat(chunks);
          handleLog(`Completed file ${filename}: ${data.length} bytes`);

          if (fieldname === "chunk") {
            fields.push({
              name: "progressStreamed",
              data: Buffer.from("1", "utf-8"),
              type: "field",
            });

            const fileIdField = fields.find(
              (x) => x.type === "field" && x.name === "fileId"
            );
            const fileIdForReset = fileIdField?.data?.toString();
            if (fileIdForReset) {
              const jobForReset = activeJobs.get(fileIdForReset);
              if (jobForReset) {
                // @ts-ignore
                delete (jobForReset as any)["__streamedInCurrentChunk__"];
                // @ts-ignore
                (jobForReset as any)["__lastEmittedMB__"] = Math.floor(
                  Math.min(
                    jobForReset.uploadedSize || 0,
                    jobForReset.totalSize || Number.POSITIVE_INFINITY
                  ) /
                    (1024 * 1024)
                );
              }
            }
          }

          fields.push({
            name: fieldname,
            filename: filename,
            data: data,
            type: "file",
            encoding: encoding,
            mimetype: mimeType,
          });
        });

        file.on("error", (err: Error) => {
          handleLog(`File upload error for ${filename}: ${err.message}`);
          reject(
            handleApiError(
              400,
              `File upload error: ${err.message}`,
              "File upload failed"
            )
          );
        });
      });

      bb.on("field", (fieldname: string, value: string) => {
        fields.push({
          name: fieldname,
          data: Buffer.from(value, "utf-8"),
          type: "field",
        });
      });

      bb.on("finish", () => {
        resolve(fields);
      });

      bb.on("error", (err: Error) => {
        handleLog(`Busboy parsing error: ${err.message}`);
        if (err.message.includes("File too large")) {
          reject(
            handleApiError(
              413,
              `File too large: exceeds ${maxFileSize} bytes`,
              "File size exceeds limit"
            )
          );
        } else {
          reject(
            handleApiError(
              400,
              `Multipart parsing error: ${err.message}`,
              "Failed to parse upload"
            )
          );
        }
      });

      const nodeReq = event.node.req;
      nodeReq.pipe(bb);
    } catch (error) {
      handleLog(
        `Error setting up Busboy parser: ${error instanceof Error ? error.message : String(error)}`
      );
      reject(
        handleApiError(
          400,
          `Parser setup error: ${error instanceof Error ? error.message : String(error)}`,
          "Failed to initialize file parser"
        )
      );
    }
  });
}

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

  const MAX_FILE_SIZE = 2 * 1024 * 1024 * 1024;
  if (fileSize > MAX_FILE_SIZE) {
    throw handleApiError(
      413,
      `File too large: ${fileSize} bytes (max: ${MAX_FILE_SIZE} bytes)`,
      "File size exceeds maximum allowed limit"
    );
  }

  const userTempDir = path.join(tmpdir(), "ziit-chunks", userId);
  const chunksDir = path.join(userTempDir, fileId);
  mkdirSync(chunksDir, { recursive: true });

  let job = activeJobs.get(fileId);
  if (!job) {
    job = {
      id: fileId,
      fileName,
      status: ImportStatus.Processing,
      progress: 0,
      userId,
      type: ImportMethod.WAKATIME_FILE,
      totalSize: fileSize,
      uploadedSize: 0,
      fileId: fileId,
    } as ImportJob;
    activeJobs.set(fileId, job);

    if (chunkIndex === 0) {
      updateJob(job, {
        status: ImportStatus.Uploading,
        current: 0,
        total: fileSize,
      });
    }
  }

  const chunkPath = path.join(chunksDir, `chunk-${chunkIndex}`);
  writeFileSync(chunkPath, chunk.data);

  const previousUploadedSize = job.uploadedSize || 0;
  const newUploadedSize = previousUploadedSize + chunk.data.length;
  job.uploadedSize = newUploadedSize;

  const progressStreamed = formData.some((p) => p.name === "progressStreamed");

  if (!progressStreamed) {
    updateJob(job, {
      status: ImportStatus.Uploading,
      current: newUploadedSize,
      total: fileSize,
    });
  }

  handleLog(
    `Received chunk ${chunkIndex + 1}/${totalChunks} for file ${fileId} (${(newUploadedSize / (1024 * 1024)).toFixed(2)}MB/${(fileSize / (1024 * 1024)).toFixed(2)}MB)`
  );

  return { success: true, chunkIndex, totalChunks };
}

async function processFileInBackground(fileId: string, userId: string) {
  const job = activeJobs.get(fileId);
  if (!job || job.fileId !== fileId) {
    throw handleApiError(
      404,
      `Job not found for file ID ${fileId}`,
      "Import job not found."
    );
  }

  updateJob(job, {
    status: ImportStatus.Processing,
  });

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
    const daysWithData = wakaData.days.filter(
      (day) => day.heartbeats && day.heartbeats.length > 0
    );
    handleLog(
      `Processing WakaTime export with ${daysWithData.length} days of data (${wakaData.days.length} total days in file)`
    );

    const queueJobId = queueImport(
      ImportMethod.WAKATIME_FILE,
      userId,
      { exportData: wakaData as unknown as WakatimeExportData, jobId: fileId },
      fileId
    );

    return {
      success: true,
      jobId: queueJobId,
      message: "File import has been queued for processing",
    };
  } catch (error) {
    updateJob(job, {
      status: ImportStatus.Failed,
      error: error instanceof Error ? error.message : String(error),
    });
    job.error = error instanceof Error ? error.message : String(error);
    activeJobs.set(fileId, job);
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

  if (event.method === "GET") {
    const queueStatus = getQueueStatus();
    const userJobs = getAllJobStatuses(userId);

    return {
      success: true,
      queue: queueStatus,
      userJobs: userJobs.slice(0, 10),
      hasActiveJobs: userJobs.some(
        (job) =>
          job.status !== ImportStatus.Completed &&
          job.status !== ImportStatus.Failed
      ),
    };
  }

  const contentType = getHeader(event, "content-type") || "";

  if (contentType.includes("multipart/form-data")) {
    const formData = await safeReadMultipartFormData(event);

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
      return handleChunkUpload(formData, userId);
    }

    const fileData = formData.find(
      (item) => item.name === "file" && item.filename
    );

    if (fileData && fileData.data) {
      const filename = fileData.filename || "";
      const isCSV = filename.toLowerCase().endsWith(".csv");

      if (isCSV) {
        handleLog("Processing CodeTime CSV file upload");

        try {
          const fileContent = new TextDecoder().decode(fileData.data);
          const codetimeData = parseCodetimeCSV(fileContent);

          if (codetimeData.records.length === 0) {
            throw handleApiError(
              400,
              "No valid records found in CodeTime CSV",
              "Invalid file format"
            );
          }

          handleLog(
            `Processing CodeTime export with ${codetimeData.records.length} records`
          );

          const jobId = randomUUID();
          const job: ImportJob = {
            id: jobId,
            fileName: filename || `CodeTime Import ${new Date().toISOString()}`,
            status: ImportStatus.Processing,
            progress: 0,
            userId,
            type: ImportMethod.CODETIME,
          } as ImportJob;
          activeJobs.set(jobId, job);

          updateJob(job, {
            status: ImportStatus.Processing,
          });

          const queueJobId = queueImport(
            ImportMethod.CODETIME,
            userId,
            { exportData: codetimeData as unknown as WakatimeExportData, jobId },
            jobId
          );

          return {
            success: true,
            jobId: queueJobId,
            message: "CodeTime import has been queued for processing",
          };
        } catch (error: any) {
          if (error && typeof error === "object" && "__h3_error__" in error) {
            throw error;
          }
          const errorMessage =
            error instanceof Error ? error.message : String(error);
          throw handleApiError(
            400,
            `Failed to process CodeTime file: ${errorMessage}`,
            "Failed to process uploaded file"
          );
        }
      }

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
        const daysWithData = wakaData.days.filter(
          (day) => day.heartbeats && day.heartbeats.length > 0
        );
        handleLog(
          `Processing WakaTime export with ${daysWithData.length} days of data (${wakaData.days.length} total days in file)`
        );

        const jobId = randomUUID();
        const job: ImportJob = {
          id: jobId,
          fileName:
            fileData.filename || `WakaTime Import ${new Date().toISOString()}`,
          status: ImportStatus.Processing,
          progress: 0,
          userId,
          type: ImportMethod.WAKATIME_FILE,
        } as ImportJob;
        activeJobs.set(jobId, job);

        updateJob(job, {
          status: ImportStatus.Processing,
        });

        const queueJobId = queueImport(
          ImportMethod.WAKATIME_FILE,
          userId,
          { exportData: wakaData as unknown as WakatimeExportData, jobId },
          jobId
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

  const importMethod =
    instanceType === "wakapi" ? ImportMethod.WAKAPI : ImportMethod.WAKATIME_API;

  const provider = getProvider(importMethod);

  if (!provider) {
    throw handleApiError(
      400,
      `Unknown provider: ${instanceType}`,
      "Invalid instance type specified"
    );
  }

  switch (instanceType) {
    case "wakapi": {
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

      handleLog(`Received WakAPI import request`);
      const jobId = queueImport(ImportMethod.WAKAPI, userId, {
        apiKey,
        instanceUrl,
      });
      return {
        success: true,
        jobId,
        message: "WakAPI import has been queued for processing",
      };
    }

    case "wakatime": {
      if (!apiKey) {
        throw handleApiError(
          400,
          "WakaTime API key missing - use file upload instead",
          "WakaTime API key is required for API import. Use file upload as alternative."
        );
      }

      handleLog(`Received WakaTime import request`);
      const jobId = queueImport(ImportMethod.WAKATIME_API, userId, { apiKey });
      return {
        success: true,
        jobId,
        message: "WakaTime import has been queued for processing",
      };
    }

    default:
      throw handleApiError(
        400,
        "Invalid instance type",
        "Invalid instance type specified"
      );
  }
});
