export enum ImportStatus {
  Processing = "Processing",
  ProcessingHeartbeats = "Processing heartbeats",
  Uploading = "Uploading",
  CreatingDataDumpRequest = "Creating data dump request",
  WaitingForDataDump = "Waiting for data dump",
  Downloading = "Downloading",
  FetchingMetadata = "Fetching metadata",
  Completed = "Completed",
  Failed = "Failed",
}

export type ImportMethod = "wakatime-api" | "wakatime-file" | "wakapi";

export interface ImportJob {
  id: string;
  fileName: string;
  status: ImportStatus;
  message?: string;
  progress: number;
  importedCount?: number;
  error?: string;
  userId: string;
  type?: ImportMethod;
  totalSize?: number;
  uploadedSize?: number;
  processedCount?: number;
  totalToProcess?: number;
  fileId?: string;
  data?: {
    heartbeatsByDate?: Record<string, any[]>;
    apiKey?: string;
    instanceUrl?: string;
    jobId?: string;
  };
}

export interface QueueJob {
  id: string;
  type: "wakatime-api" | "wakatime-file" | "wakapi";
  userId: string;
  data: {
    apiKey?: string;
    exportData?: WakatimeExportData;
    instanceUrl?: string;
    jobId?: string;
    heartbeatsByDate?: Record<string, any[]>;
  };
  createdAt: Date;
  allocatedWorkers?: number;
}

export interface WorkChunk {
  id: string;
  jobId: string;
  type: "date-range" | "heartbeat-batch";
  data: {
    days?: any[];
    dates?: string[];
    heartbeatsByDate?: Record<string, any[]>;
    chunkIndex: number;
    totalChunks: number;
    originalJob: QueueJob;
    processedDays?: number;
  };
  status: "pending" | "processing" | "completed" | "failed";
  progress: number;
  workerId?: number;
}

export interface JobUpdateOptions {
  status: ImportStatus;
  current?: number;
  total?: number;
  importedCount?: number;
  error?: string;
  additionalInfo?: string;
}
