import { randomUUID } from "crypto";
import { Worker, isMainThread, parentPort, workerData } from "worker_threads";
import { handleLog } from "./logging";
import {
  handleWakatimeImport,
  handleWakatimeFileImport,
  type WakatimeExportData,
  mapHeartbeat,
} from "./wakatime";
import { handleWakApiImport } from "./wakapi";
import { processHeartbeatsByDate } from "./summarize";

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
  allocatedWorkers?: number;
}

interface WorkChunk {
  id: string;
  jobId: string;
  type: "date-range" | "heartbeat-batch";
  data: {
    days?: any[];
    chunkIndex: number;
    totalChunks: number;
    originalJob: QueueJob;
    processedDays?: number;
  };
  status: "pending" | "processing" | "completed" | "failed";
  progress: number;
  workerId?: number;
}

export const activeJobs = new Map<string, ImportJob>();

class ImportQueue {
  private static instance: ImportQueue;
  private queue: QueueJob[] = [];
  private workChunks: Map<string, WorkChunk> = new Map();
  private workers: Promise<void>[] = [];
  private workerThreads: Map<number, Worker> = new Map();
  private workerCount = 10;
  private workerJobAssignment: Map<number, string> = new Map();
  private jobWorkerCount: Map<string, number> = new Map();
  private completedChunks: Map<string, Set<string>> = new Map();

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
      this.workers.push(this.createAsyncWorker(i));
    }
  }

  private createWorkerThread(workerId: number): void {
    const worker = new Worker(__filename, {
      workerData: { workerId, isWorkerThread: true },
    });

    worker.on("message", (message) => {
      this.handleWorkerMessage(workerId, message);
    });

    worker.on("error", (error) => {
      handleLog(`Worker thread ${workerId} error: ${error.message}`);
      this.restartWorkerThread(workerId);
    });

    worker.on("exit", (code) => {
      if (code !== 0) {
        handleLog(`Worker thread ${workerId} exited with code ${code}`);
        this.restartWorkerThread(workerId);
      }
    });

    this.workerThreads.set(workerId, worker);
  }

  private restartWorkerThread(workerId: number): void {
    const oldWorker = this.workerThreads.get(workerId);
    if (oldWorker) {
      oldWorker.terminate();
    }
    this.workerJobAssignment.delete(workerId);
    setTimeout(() => {
      this.createWorkerThread(workerId);
    }, 2000);
  }

  private handleWorkerMessage(workerId: number, message: any): void {
    switch (message.type) {
      case "requestWork":
        this.assignWorkToThread(workerId);
        break;
      case "workComplete":
        this.handleWorkCompletion(workerId, message.data);
        break;
      case "progress":
        this.handleProgressUpdate(message.data);
        break;
      case "log":
        handleLog(`Worker ${workerId}: ${message.message}`);
        break;
      case "error":
        handleLog(`Worker ${workerId} error: ${message.error}`);
        break;
    }
  }

  private async assignWorkToThread(workerId: number): Promise<void> {
    const workItem = await this.getNextWorkItem(workerId);

    const worker = this.workerThreads.get(workerId);
    if (!worker) return;

    if (workItem.job) {
      worker.postMessage({
        type: "processJob",
        data: workItem.job,
      });
    } else if (workItem.chunk) {
      worker.postMessage({
        type: "processChunk",
        data: workItem.chunk,
      });
    } else {
      setTimeout(() => {
        worker.postMessage({ type: "requestWork" });
      }, 1000);
    }
  }

  private handleWorkCompletion(workerId: number, data: any): void {
    this.cleanupWorkerAssignment(workerId);

    if (data.type === "chunk") {
      this.handleChunkCompletion(data.chunkId, data.success);
    } else if (data.type === "job") {
      this.checkJobCompletion(data.jobId);
    }

    const worker = this.workerThreads.get(workerId);
    if (worker) {
      worker.postMessage({ type: "requestWork" });
    }
  }

  private handleProgressUpdate(data: any): void {
    if (data.chunkId) {
      const chunk = this.workChunks.get(data.chunkId);
      if (chunk) {
        chunk.progress = data.progress;
        this.updateJobProgress(chunk.jobId);
      }
    }
  }

  private async createAsyncWorker(workerId: number): Promise<void> {
    while (true) {
      try {
        const workItem = await this.getNextWorkItem(workerId);

        if (workItem.job) {
          await this.processJob(workItem.job, workerId);
        } else if (workItem.chunk) {
          await this.processWorkChunk(workItem.chunk, workerId);
        } else {
          await new Promise((resolve) => setTimeout(resolve, 1000));
        }
      } catch (error) {
        handleLog(
          `Worker ${workerId} error: ${error instanceof Error ? error.message : String(error)}`,
        );
        this.cleanupWorkerAssignment(workerId);
        await new Promise((resolve) => setTimeout(resolve, 2000));
      }
    }
  }

  private async getNextWorkItem(
    workerId: number,
  ): Promise<{ job?: QueueJob; chunk?: WorkChunk }> {
    const pendingChunk = Array.from(this.workChunks.values()).find(
      (chunk) => chunk.status === "pending",
    );

    if (pendingChunk) {
      pendingChunk.status = "processing";
      pendingChunk.workerId = workerId;
      this.workerJobAssignment.set(workerId, pendingChunk.jobId);
      return { chunk: pendingChunk };
    }

    const activeJobCount = new Set(this.workerJobAssignment.values()).size;

    if (activeJobCount >= this.workerCount) {
      return {};
    }

    const job = this.queue.shift();
    if (!job) {
      return {};
    }

    const futureActiveJobs = activeJobCount + 1;

    const workersPerJob = Math.floor(this.workerCount / futureActiveJobs);
    const extraWorkers = this.workerCount % futureActiveJobs;

    const workersForJob = workersPerJob + (extraWorkers > 0 ? 1 : 0);

    job.allocatedWorkers = workersForJob;
    this.jobWorkerCount.set(job.id, workersForJob);

    if (workersForJob > 1 && this.canParallelize(job)) {
      this.createWorkChunks(job);

      const firstChunk = Array.from(this.workChunks.values()).find(
        (chunk) => chunk.jobId === job.id && chunk.status === "pending",
      );

      if (firstChunk) {
        firstChunk.status = "processing";
        firstChunk.workerId = workerId;
        this.workerJobAssignment.set(workerId, job.id);
        return { chunk: firstChunk };
      }
    }

    this.workerJobAssignment.set(workerId, job.id);
    return { job };
  }

  private canParallelize(job: QueueJob): boolean {
    return !!(
      job.type === "wakatime-file" &&
      job.data.exportData?.days &&
      job.data.exportData.days.length > 10
    );
  }

  private createWorkChunks(job: QueueJob): void {
    if (!job.data.exportData?.days || !job.allocatedWorkers) return;

    const days = job.data.exportData.days;
    const chunkSize = Math.ceil(days.length / job.allocatedWorkers);

    const existingJob = activeJobs.get(job.id);
    if (existingJob) {
      existingJob.totalToProcess = days.length;
      existingJob.processedCount = 0;
      existingJob.status = "Processing heartbeats";
      activeJobs.set(job.id, existingJob);
    }

    this.completedChunks.set(job.id, new Set());

    for (let i = 0; i < job.allocatedWorkers; i++) {
      const start = i * chunkSize;
      const end = Math.min(start + chunkSize, days.length);

      if (start < days.length) {
        const chunk: WorkChunk = {
          id: `${job.id}-chunk-${i}`,
          jobId: job.id,
          type: "date-range",
          data: {
            days: days.slice(start, end),
            chunkIndex: i,
            totalChunks: job.allocatedWorkers,
            originalJob: job,
            processedDays: 0,
          },
          status: "pending",
          progress: 0,
        };

        this.workChunks.set(chunk.id, chunk);
      }
    }
  }

  private async processWorkChunk(
    chunk: WorkChunk,
    workerId: number,
  ): Promise<void> {
    try {
      const jobId = chunk.jobId;
      const job = activeJobs.get(jobId);
      if (!job) {
        handleLog(`Job ${jobId} not found for chunk ${chunk.id}`);
        return;
      }
      if (chunk.type === "date-range" && chunk.data.days) {
        await this.processDateRangeChunk(chunk, job, workerId);
      }

      chunk.status = "completed";
      chunk.progress = 100;

      const completedSet = this.completedChunks.get(chunk.jobId);
      if (completedSet) {
        completedSet.add(chunk.id);
      }

      this.updateJobProgress(chunk.jobId);
      await this.checkJobCompletion(chunk.jobId);
    } catch (error) {
      chunk.status = "failed";
      handleLog(`Worker ${workerId} failed chunk ${chunk.id}: ${error}`);
    } finally {
      this.cleanupWorkerAssignment(workerId);
    }
  }

  private async processDateRangeChunk(
    chunk: WorkChunk,
    job: ImportJob,
    workerId: number,
  ): Promise<void> {
    const { days } = chunk.data;
    let processedInChunk = 0;
    let processedDaysWithData = 0;
    const totalInChunk = days?.length || 0;

    for (const day of days || []) {
      if (!day.heartbeats || day.heartbeats.length === 0) {
        processedInChunk++;

        if (processedInChunk % 5 === 0 || processedInChunk === totalInChunk) {
          chunk.progress = Math.round((processedInChunk / totalInChunk) * 100);
          this.updateJobProgress(job.id);
        }
        continue;
      }

      try {
        const userAgents = new Map();
        const processedHeartbeats = day.heartbeats.map((h: any) =>
          mapHeartbeat(
            h,
            userAgents,
            job.userId,
            chunk.data.originalJob.data.exportData?.user.last_plugin,
          ),
        );

        await processHeartbeatsByDate(job.userId, processedHeartbeats);
        processedInChunk++;
        processedDaysWithData++;
        chunk.data.processedDays = processedDaysWithData;

        if (processedInChunk % 5 === 0 || processedInChunk === totalInChunk) {
          chunk.progress = Math.round((processedInChunk / totalInChunk) * 100);
          this.updateJobProgress(job.id);
        }
      } catch (error) {
        handleLog(
          `Worker ${workerId} error processing day ${day.date}: ${error}`,
        );
        processedInChunk++;
      }
    }
  }

  private updateJobProgress(jobId: string): void {
    const job = activeJobs.get(jobId);
    if (!job) {
      handleLog(`Job ${jobId} not found for progress update`);
      return;
    }

    const jobChunks = Array.from(this.workChunks.values()).filter(
      (c) => c.jobId === jobId,
    );

    if (jobChunks.length === 0) {
      handleLog(`No chunks found for job ${jobId}`);
      return;
    }

    const totalProcessedDays = jobChunks.reduce(
      (sum, chunk) => sum + (chunk.data.processedDays || 0),
      0,
    );

    const oldProgress = job.progress;
    const oldProcessedCount = job.processedCount || 0;

    job.processedCount = totalProcessedDays;
    job.progress = job.totalToProcess
      ? Math.min(
          99,
          Math.round((totalProcessedDays / job.totalToProcess) * 100),
        )
      : Math.min(
          99,
          Math.round(
            jobChunks.reduce((sum, chunk) => sum + chunk.progress, 0) /
              jobChunks.length,
          ),
        );

    activeJobs.set(jobId, job);

    if (
      oldProgress !== job.progress ||
      oldProcessedCount !== job.processedCount
    ) {
      handleLog(
        `Job ${jobId} progress: ${job.processedCount}/${job.totalToProcess} days (${job.progress}%)`,
      );
    }
  }

  private async checkJobCompletion(jobId: string): Promise<void> {
    const jobChunks = Array.from(this.workChunks.values()).filter(
      (c) => c.jobId === jobId,
    );
    const completedChunks = jobChunks.filter((c) => c.status === "completed");

    if (completedChunks.length === jobChunks.length && jobChunks.length > 0) {
      const job = activeJobs.get(jobId);
      if (job) {
        job.status = "Completed";
        job.progress = 100;

        const totalDaysWithData = jobChunks.reduce(
          (sum, chunk) => sum + (chunk.data.processedDays || 0),
          0,
        );
        job.importedCount = totalDaysWithData;

        activeJobs.set(jobId, job);
        handleLog(
          `Job ${jobId} completed - processed ${totalDaysWithData} days across ${jobChunks.length} chunks`,
        );
      }

      jobChunks.forEach((chunk) => this.workChunks.delete(chunk.id));
      this.jobWorkerCount.delete(jobId);
      this.completedChunks.delete(jobId);
    }
  }

  private async processJob(job: QueueJob, workerId: number): Promise<void> {
    try {
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

          result = await handleWakatimeImport(
            job.data.apiKey,
            job.userId,
            wakatimeJob,
          );
          break;

        case "wakatime-file":
          if (!job.data.exportData || !job.data.jobId) {
            throw new Error(
              "Export data and job ID are required for WakaTime file import",
            );
          }

          const existingJob = activeJobs.get(job.id);
          if (existingJob) {
            existingJob.status = "Processing";
            existingJob.totalToProcess = job.data.exportData.days?.length || 0;
            existingJob.processedCount = 0;
            activeJobs.set(job.id, existingJob);
            result = await handleWakatimeFileImport(
              job.data.exportData,
              job.userId,
              existingJob,
            );
          } else {
            const fileJob: ImportJob = {
              id: job.id,
              fileName: `WakaTime File Import ${new Date().toISOString()}`,
              status: "Processing",
              progress: 0,
              userId: job.userId,
              totalToProcess: job.data.exportData.days?.length || 0,
              processedCount: 0,
            };
            activeJobs.set(job.id, fileJob);
            result = await handleWakatimeFileImport(
              job.data.exportData,
              job.userId,
              fileJob,
            );
          }
          break;

        case "wakapi":
          if (!job.data.apiKey || !job.data.instanceUrl) {
            throw new Error(
              "API key and instance URL are required for WakAPI import",
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

          result = await handleWakApiImport(
            job.data.apiKey,
            job.data.instanceUrl,
            job.userId,
            wakapiJob,
          );
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
    } finally {
      this.cleanupWorkerAssignment(workerId);
    }
  }

  private cleanupWorkerAssignment(workerId: number): void {
    this.workerJobAssignment.delete(workerId);
  }

  private handleChunkCompletion(chunkId: string, success: boolean): void {
    const chunk = this.workChunks.get(chunkId);
    if (chunk) {
      chunk.status = success ? "completed" : "failed";
      chunk.progress = success ? 100 : 0;

      if (success) {
        const completedSet = this.completedChunks.get(chunk.jobId);
        if (completedSet) {
          completedSet.add(chunkId);
        }
      }

      this.checkJobCompletion(chunk.jobId);
    }
  }

  addJob(job: QueueJob): string {
    this.queue.push(job);
    handleLog(
      `Added job ${job.id} (${job.type}) to queue. Queue length: ${this.queue.length}`,
    );
    return job.id;
  }

  getStatus() {
    const busyWorkerCount = this.workerJobAssignment.size;
    const activeJobsCount = Array.from(activeJobs.values()).filter(
      (job) =>
        job.status === "Processing" || job.status.startsWith("Processing"),
    ).length;

    return {
      queueLength: this.queue.length,
      busyWorkers: busyWorkerCount,
      availableWorkers: this.workerCount - busyWorkerCount,
      totalWorkers: this.workerCount,
      activeJobs: activeJobsCount,
      workChunks: this.workChunks.size,
      workerDistribution: Object.fromEntries(
        Array.from(this.jobWorkerCount.entries()).map(([jobId, count]) => [
          activeJobs.get(jobId)?.fileName || jobId,
          count,
        ]),
      ),
    };
  }
}

if (!isMainThread && workerData?.isWorkerThread) {
  parentPort?.postMessage({ type: "requestWork" });

  parentPort?.on("message", async (message) => {
    try {
      switch (message.type) {
        case "processJob":
          await processJobInThread(message.data);
          break;
        case "processChunk":
          await processChunkInThread(message.data);
          break;
        case "requestWork":
          parentPort?.postMessage({ type: "requestWork" });
          break;
      }
    } catch (error) {
      parentPort?.postMessage({
        type: "error",
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });
}

async function processJobInThread(job: QueueJob): Promise<void> {
  parentPort?.postMessage({
    type: "log",
    message: `Processing job ${job.id} (${job.type})`,
  });

  let result: any;
  let success = false;

  try {
    switch (job.type) {
      case "wakatime-api":
        result = await handleWakatimeImport(job.data.apiKey!, job.userId);
        break;
      case "wakapi":
        result = await handleWakApiImport(
          job.data.apiKey!,
          job.data.instanceUrl!,
          job.userId,
        );
        break;

      default:
        throw new Error(`Job type ${job.type} not supported in worker threads`);
    }
    success = true;
  } catch (error) {
    parentPort?.postMessage({
      type: "error",
      error: error instanceof Error ? error.message : String(error),
    });
  }

  parentPort?.postMessage({
    type: "workComplete",
    data: { type: "job", jobId: job.id, success, result },
  });
}

async function processChunkInThread(chunk: WorkChunk): Promise<void> {
  parentPort?.postMessage({
    type: "log",
    message: `Processing chunk ${chunk.id} with ${chunk.data.days?.length || 0} days`,
  });

  const { days } = chunk.data;
  let processedInChunk = 0;
  const totalInChunk = days?.length || 0;
  let success = false;

  try {
    for (const day of days || []) {
      if (!day.heartbeats || day.heartbeats.length === 0) {
        processedInChunk++;
        continue;
      }

      const userAgents = new Map();
      const processedHeartbeats = day.heartbeats.map((h: any) =>
        mapHeartbeat(
          h,
          userAgents,
          chunk.data.originalJob.userId,
          chunk.data.originalJob.data.exportData?.user.last_plugin,
        ),
      );

      await processHeartbeatsByDate(
        chunk.data.originalJob.userId,
        processedHeartbeats,
      );
      processedInChunk++;

      if (processedInChunk % 10 === 0 || processedInChunk === totalInChunk) {
        const progress = Math.round((processedInChunk / totalInChunk) * 100);
        parentPort?.postMessage({
          type: "progress",
          data: { chunkId: chunk.id, progress },
        });
      }
    }
    success = true;
  } catch (error) {
    parentPort?.postMessage({
      type: "error",
      error: error instanceof Error ? error.message : String(error),
    });
  }

  parentPort?.postMessage({
    type: "workComplete",
    data: { type: "chunk", chunkId: chunk.id, success },
  });
}

const importQueue = ImportQueue.getInstance();

export const queueWakatimeApiImport = (
  apiKey: string,
  userId: string,
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
  jobId: string,
): string => {
  const job: QueueJob = {
    id: jobId,
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
  userId: string,
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
