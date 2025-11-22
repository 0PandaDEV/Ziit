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

export enum ImportMethod {
  WAKATIME_API,
  WAKATIME_FILE,
  WAKAPI,
  CODETIME,
}

export enum WorkChunkStatus {
  PENDING,
  PROCESSING,
  COMPLETED,
  FAILED,
}

export enum WorkChunkType {
  DATE_RANGE,
  HEARTBEAT_BATCH,
}

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
    exportData?: any;
  };
}

export interface QueueJob {
  id: string;
  type: ImportMethod;
  userId: string;
  data: {
    apiKey?: string;
    exportData?: {
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
        heartbeats: any[];
      }>;
    };
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
  type: WorkChunkType;
  data: {
    days?: any[];
    dates?: string[];
    heartbeatsByDate?: Record<string, any[]>;
    chunkIndex: number;
    totalChunks: number;
    originalJob: QueueJob;
    processedDays?: number;
  };
  status: WorkChunkStatus;
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
