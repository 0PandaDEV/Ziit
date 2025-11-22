import { ImportJob, QueueJob, ImportMethod } from "~~/types/import";
import { wakatimeApiProvider, wakatimeFileProvider } from "./wakatime";
import { wakapiProvider } from "./wakapi";
import { codetimeProvider } from "./codetime";

export interface ProcessedHeartbeat {
  userId: string;
  timestamp: Date | number;
  project: string | null;
  editor: string;
  language: string | null;
  os: string;
  file: string | null;
  branch: string | null;
  createdAt: Date;
  summariesId: null;
}

export interface ImportResult {
  success: boolean;
  imported: number;
  message?: string;
}

export interface ProviderConfig {
  displayName: string;
  logPrefix: string;
}

export interface ChunkData {
  days?: any[];
  dates?: string[];
  heartbeatsByDate?: Record<string, any[]>;
  chunkIndex: number;
  totalChunks: number;
  originalJob: QueueJob;
  processedDays?: number;
}

export interface ImportProvider {
  name: ImportMethod;
  config: ProviderConfig;

  validateJob(data: QueueJob["data"]): void;
  processJob(
    job: QueueJob,
    importJob: ImportJob,
    helpers: ProcessJobHelpers
  ): Promise<ImportResult>;
  processChunk(
    chunkData: ChunkData,
    userId: string
  ): Promise<{ processed: number }>;
}

export interface ProcessJobHelpers {
  getOrCreateJob: (
    jobId: string,
    userId: string,
    type: ImportMethod,
    fileName: string,
    totalToProcess?: number
  ) => ImportJob;
  updateJob: (job: ImportJob, options: any) => void;
  activeJobs: Map<string, ImportJob>;
  canParallelize: (job: QueueJob) => boolean;
  createWorkChunks: (
    job: QueueJob,
    items: any[],
    dataType: ImportMethod
  ) => void;
}

export interface ImportConfig {
  apiKey: string;
  instanceUrl?: string;
}

export interface UserAgentInfo {
  os: string;
  editor: string;
}

const providers: Record<ImportMethod, ImportProvider> = {
  [ImportMethod.WAKATIME_API]: wakatimeApiProvider,
  [ImportMethod.WAKATIME_FILE]: wakatimeFileProvider,
  [ImportMethod.WAKAPI]: wakapiProvider,
  [ImportMethod.CODETIME]: codetimeProvider,
};

export function getProvider(name: ImportMethod): ImportProvider {
  return providers[name];
}
