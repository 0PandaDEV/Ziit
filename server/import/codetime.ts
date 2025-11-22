import z from "zod";
import { handleLog } from "~~/server/utils/logging";
import { updateJob } from "~~/server/utils/import-queue";
import { ImportJob, ImportStatus, QueueJob, ImportMethod } from "~~/types/import";
import { ImportProvider, ImportResult, ProcessedHeartbeat, ProcessJobHelpers, ChunkData } from "./types";
import { extractFileName } from "./helpers";

const codetimeRecordSchema = z.object({
  Language: z.string(),
  Workspace: z.string(),
  "Absolute File": z.string(),
  "Relative File": z.string(),
  Editor: z.string(),
  Platform: z.string(),
  "Git Origin": z.string(),
  "Git Branch": z.string(),
  "Recorded At": z.string(),
});

export type CodetimeRecord = z.infer<typeof codetimeRecordSchema>;

export const codetimeExportSchema = z.object({
  records: z.array(codetimeRecordSchema),
});

export type CodetimeExportData = z.infer<typeof codetimeExportSchema>;

function parseCSVLine(line: string): string[] {
  const values: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];

    if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === "," && !inQuotes) {
      values.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }
  values.push(current.trim());

  return values;
}

export function parseCodetimeCSV(csvContent: string): CodetimeExportData {
  const lines = csvContent.trim().split("\n");
  if (lines.length < 2) {
    return { records: [] };
  }

  const headers = lines[0].split(",").map(h => h.trim());
  const records: CodetimeRecord[] = [];

  for (let i = 1; i < lines.length; i++) {
    const values = parseCSVLine(lines[i]);
    if (values.length !== headers.length) continue;

    const record: Record<string, string> = {};
    headers.forEach((header, index) => {
      record[header] = values[index];
    });

    const parsed = codetimeRecordSchema.safeParse(record);
    if (parsed.success) {
      records.push(parsed.data);
    }
  }

  return { records };
}

function processCodetimeRecord(record: CodetimeRecord, userId: string): ProcessedHeartbeat {
  const timestamp = new Date(record["Recorded At"]).getTime();

  return {
    userId,
    timestamp: isNaN(timestamp) ? Date.now() : timestamp,
    project: record.Workspace || null,
    editor: record.Editor || "unknown",
    language: record.Language || null,
    os: record.Platform || "unknown",
    file: extractFileName(record["Absolute File"] || record["Relative File"]),
    branch: record["Git Branch"] || null,
    createdAt: new Date(),
    summariesId: null,
  };
}

function groupRecordsByDate(records: CodetimeRecord[], userId: string): Map<string, ProcessedHeartbeat[]> {
  const heartbeatsByDate = new Map<string, ProcessedHeartbeat[]>();

  for (const record of records) {
    const heartbeat = processCodetimeRecord(record, userId);
    const date = new Date(heartbeat.timestamp as number);
    const dateStr = date.toISOString().split("T")[0];

    if (!heartbeatsByDate.has(dateStr)) {
      heartbeatsByDate.set(dateStr, []);
    }
    heartbeatsByDate.get(dateStr)!.push(heartbeat);
  }

  return heartbeatsByDate;
}

export const codetimeProvider: ImportProvider = {
  name: ImportMethod.CODETIME,
  config: {
    displayName: "CodeTime",
    logPrefix: "codetime",
  },

  validateJob(data: QueueJob["data"]): void {
    if (!data.exportData) {
      throw new Error("Export data is required for CodeTime import");
    }
  },

  async processJob(
    job: QueueJob,
    importJob: ImportJob,
    helpers: ProcessJobHelpers
  ): Promise<ImportResult> {
    const exportData = job.data.exportData as unknown as CodetimeExportData;

    if (!exportData.records || exportData.records.length === 0) {
      throw new Error("No records found in CodeTime export");
    }

    updateJob(importJob, {
      status: ImportStatus.Processing,
    });

    const heartbeatsByDate = groupRecordsByDate(exportData.records, job.userId);
    const datesWithData = Array.from(heartbeatsByDate.keys());

    handleLog(`[${this.config.logPrefix}] Processing ${datesWithData.length} days with ${exportData.records.length} records`);

    importJob.totalToProcess = datesWithData.length;
    const heartbeatsByDateObj = Object.fromEntries(heartbeatsByDate);
    importJob.data = {
      heartbeatsByDate: heartbeatsByDateObj,
    };
    job.data.heartbeatsByDate = heartbeatsByDateObj;
    helpers.activeJobs.set(job.id, importJob);

    helpers.createWorkChunks(job, datesWithData, ImportMethod.CODETIME);

    return {
      success: true,
      imported: 0,
      message: `Parallel processing initiated for ${datesWithData.length} days`,
    };
  },

  async processChunk(chunkData: ChunkData, userId: string): Promise<{ processed: number }> {
    const { processHeartbeatsByDate } = await import("~~/server/utils/summarize");
    const { dates, heartbeatsByDate } = chunkData;

    let totalProcessed = 0;

    for (const dateStr of dates || []) {
      const heartbeats = heartbeatsByDate?.[dateStr];
      if (heartbeats && heartbeats.length > 0) {
        await processHeartbeatsByDate(userId, heartbeats);
        totalProcessed += heartbeats.length;
      }
    }

    return { processed: totalProcessed };
  },
};

export async function handleCodetimeDateChunk(
  dates: string[],
  userId: string,
  heartbeatsByDate: Record<string, ProcessedHeartbeat[]>
): Promise<{ success: boolean; processed: number }> {
  const { processHeartbeatsByDate } = await import("~~/server/utils/summarize");

  try {
    let totalProcessed = 0;

    for (const dateStr of dates) {
      const heartbeats = heartbeatsByDate[dateStr];
      if (heartbeats && heartbeats.length > 0) {
        await processHeartbeatsByDate(userId, heartbeats);
        totalProcessed += heartbeats.length;
      }
    }

    return {
      success: true,
      processed: totalProcessed,
    };
  } catch (error) {
    handleLog(
      `[codetime] Failed to process date chunk for user ${userId}: ${error}`
    );
    throw error;
  }
}
