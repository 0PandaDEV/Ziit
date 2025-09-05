import { randomUUID } from "crypto";
import { handleLog } from "./logging";
import {
  handleWakatimeImport,
  handleWakatimeFileImport,
  type WakatimeExportData,
} from "./wakatime";
import { handleWakApiImport } from "./wakapi";

export interface ImportJob {
  id: string;
  fileName: string;
  status: string;
  progress: number;
  importedCount?: number;
  error?: string;
  userId: string;
  totalSize?: number;
  uploadedSize?: number;
  processedCount?: number;
  totalToProcess?: number;
  fileId?: string;
}

export const activeJobs = new Map<string, ImportJob>();

export interface QueueJob {
  id: string;
  type: "wakatime-api" | "wakatime-file" | "wakapi";
  userId: string;
  data: {
    apiKey?: string;
    exportData?: WakatimeExportData;
    instanceUrl?: string;
    jobId?: string;
  };
  createdAt: Date;
}

class ImportQueue {
  private static instance: ImportQueue;
  private queue: QueueJob[] = [];
  private workers: Promise<void>[] = [];
  private workerCount = 10;

  private constructor() {
    this.startWorkers();
  }

  static getInstance(): ImportQueue {
    if (!ImportQueue.instance) {
      ImportQueue.instance = new ImportQueue();
    }
    return ImportQueue.instance;
  }

  private startWorkers(): void {
    for (let i = 0; i < this.workerCount; i++) {
      this.workers.push(this.createWorker(i));
    }
    handleLog(`Started ${this.workerCount} import workers`);
  }

  private async createWorker(workerId: number): Promise<void> {
    while (true) {
      try {
        const job = await this.getNextJob();
        if (job) {
          await this.processJob(job, workerId);
        } else {
          await new Promise((resolve) => setTimeout(resolve, 1000));
        }
      } catch (error) {
        handleLog(
          `Worker ${workerId} error: ${error instanceof Error ? error.message : String(error)}`
        );
        await new Promise((resolve) => setTimeout(resolve, 2000));
      }
    }
  }

  private async getNextJob(): Promise<QueueJob | null> {
    return this.queue.shift() || null;
  }

  private async processJob(job: QueueJob, workerId: number): Promise<void> {
    try {
      handleLog(`Worker ${workerId} processing job ${job.id} (${job.type})`);

      let result: any;

      switch (job.type) {
        case "wakatime-api":
          if (!job.data.apiKey) {
            throw new Error("API key is required for WakaTime API import");
          }

          const wakatimeJob: ImportJob = {
            id: job.id,
            fileName: `WakaTime API Import ${new Date().toISOString()}`,
            status: "Processing",
            progress: 0,
            userId: job.userId,
          };
          activeJobs.set(job.id, wakatimeJob);

          const existingJobIds = getAllJobStatuses(job.userId).map((j) => j.id);

          result = await handleWakatimeImport(job.data.apiKey, job.userId);

          const newJobs = getAllJobStatuses(job.userId).filter(
            (j) => !existingJobIds.includes(j.id)
          );
          if (newJobs.length > 0) {
            const importFunctionJob = newJobs[0];
            wakatimeJob.status = importFunctionJob.status;
            wakatimeJob.progress = importFunctionJob.progress;
            wakatimeJob.importedCount = importFunctionJob.importedCount;
            wakatimeJob.error = importFunctionJob.error;
            wakatimeJob.processedCount = importFunctionJob.processedCount;
            wakatimeJob.totalToProcess = importFunctionJob.totalToProcess;
            activeJobs.set(job.id, wakatimeJob);
            activeJobs.delete(importFunctionJob.id);
          }
          break;

        case "wakatime-file":
          if (!job.data.exportData || !job.data.jobId) {
            throw new Error(
              "Export data and job ID are required for WakaTime file import"
            );
          }

          const existingFileJob = activeJobs.get(job.data.jobId);
          if (existingFileJob) {
            const fileJob: ImportJob = {
              ...existingFileJob,
              id: job.id,
            };
            activeJobs.set(job.id, fileJob);
            activeJobs.delete(job.data.jobId);
          } else {
            const fileJob: ImportJob = {
              id: job.id,
              fileName: `WakaTime File Import ${new Date().toISOString()}`,
              status: "Processing",
              progress: 0,
              userId: job.userId,
            };
            activeJobs.set(job.id, fileJob);
          }

          result = await handleWakatimeFileImport(
            job.data.exportData,
            job.userId,
            activeJobs.get(job.id)!
          );
          break;

        case "wakapi":
          if (!job.data.apiKey || !job.data.instanceUrl) {
            throw new Error(
              "API key and instance URL are required for WakAPI import"
            );
          }

          const wakapiJob: ImportJob = {
            id: job.id,
            fileName: `WakAPI Import ${new Date().toISOString()}`,
            status: "Processing",
            progress: 0,
            userId: job.userId,
          };
          activeJobs.set(job.id, wakapiJob);

          const existingWakapiJobIds = getAllJobStatuses(job.userId).map(
            (j) => j.id
          );

          result = await handleWakApiImport(
            job.data.apiKey,
            job.data.instanceUrl,
            job.userId
          );

          const newWakapiJobs = getAllJobStatuses(job.userId).filter(
            (j) => !existingWakapiJobIds.includes(j.id)
          );
          if (newWakapiJobs.length > 0) {
            const importFunctionJob = newWakapiJobs[0];
            wakapiJob.status = importFunctionJob.status;
            wakapiJob.progress = importFunctionJob.progress;
            wakapiJob.importedCount = importFunctionJob.importedCount;
            wakapiJob.error = importFunctionJob.error;
            wakapiJob.processedCount = importFunctionJob.processedCount;
            wakapiJob.totalToProcess = importFunctionJob.totalToProcess;
            activeJobs.set(job.id, wakapiJob);
            activeJobs.delete(importFunctionJob.id);
          }
          break;

        default:
          throw new Error(`Unknown job type: ${(job as any).type}`);
      }

      const completedJob = activeJobs.get(job.id);
      if (completedJob && completedJob.status !== "Failed") {
        completedJob.status = "Completed";
        completedJob.progress = 100;
        if (result?.imported !== undefined) {
          completedJob.importedCount = result.imported;
        }
        activeJobs.set(job.id, completedJob);
      }

      handleLog(`Worker ${workerId} completed job ${job.id}`);
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      handleLog(`Worker ${workerId} failed job ${job.id}: ${errorMessage}`);

      const failedJob = activeJobs.get(job.id);
      if (failedJob) {
        failedJob.status = "Failed";
        failedJob.error = errorMessage;
        activeJobs.set(job.id, failedJob);
      } else {
        const newFailedJob: ImportJob = {
          id: job.id,
          fileName: `${job.type} Import ${new Date().toISOString()}`,
          status: "Failed",
          progress: 0,
          userId: job.userId,
          error: errorMessage,
        };
        activeJobs.set(job.id, newFailedJob);
      }
    }
  }

  addJob(job: QueueJob): string {
    this.queue.push(job);
    handleLog(
      `Added job ${job.id} (${job.type}) to queue. Queue length: ${this.queue.length}`
    );
    return job.id;
  }

  getStatus() {
    const activeJobsCount = Array.from(activeJobs.values()).filter(
      (job) => job.status === "Processing"
    ).length;

    return {
      queueLength: this.queue.length,
      busyWorkers: activeJobsCount,
      availableWorkers: this.workerCount - activeJobsCount,
      totalWorkers: this.workerCount,
    };
  }
}

export const importQueue = ImportQueue.getInstance();

export const queueWakatimeApiImport = (
  apiKey: string,
  userId: string
): string => {
  const job: QueueJob = {
    id: randomUUID(),
    type: "wakatime-api",
    userId,
    data: { apiKey },
    createdAt: new Date(),
  };
  return importQueue.addJob(job);
};

export const queueWakatimeFileImport = (
  exportData: WakatimeExportData,
  userId: string,
  jobId: string
): string => {
  const job: QueueJob = {
    id: randomUUID(),
    type: "wakatime-file",
    userId,
    data: { exportData, jobId },
    createdAt: new Date(),
  };
  return importQueue.addJob(job);
};

export const queueWakApiImport = (
  apiKey: string,
  instanceUrl: string,
  userId: string
): string => {
  const job: QueueJob = {
    id: randomUUID(),
    type: "wakapi",
    userId,
    data: { apiKey, instanceUrl },
    createdAt: new Date(),
  };
  return importQueue.addJob(job);
};

export const getQueueStatus = () => importQueue.getStatus();

export const getAllJobStatuses = (userId?: string): ImportJob[] => {
  const jobs = Array.from(activeJobs.values());
  return userId ? jobs.filter((job) => job.userId === userId) : jobs;
};

export const getJobStatus = (jobId: string): ImportJob | undefined => {
  return activeJobs.get(jobId);
};
