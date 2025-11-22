import { randomUUID } from "crypto";
import { Worker, isMainThread, parentPort, workerData } from "worker_threads";
import { handleLog } from "./logging";
import { ImportJob, ImportStatus, JobUpdateOptions, QueueJob, WorkChunk, ImportMethod, WorkChunkStatus, WorkChunkType } from "~~/types/import";
import { getProvider } from "../import/types";

export const activeJobs = new Map<string, ImportJob>();

function formatStatus(
  baseStatus: ImportStatus,
  jobType: ImportMethod,
  current?: number,
  total?: number,
  progress?: number,
  additionalInfo?: string,
  importedCount?: number,
  error?: string,
): string {
  const provider = getProvider(jobType);
  const methodPrefix = provider?.config.displayName || "Import";
  const hasProgress = current !== undefined && total !== undefined && total > 0;
  const progressStr = progress !== undefined ? ` (${progress}%)` : "";

  switch (baseStatus) {
    case ImportStatus.ProcessingHeartbeats:
      if (hasProgress) {
        const info = additionalInfo ? ` ${additionalInfo}` : "";
        return `[${methodPrefix}] Importing data: ${current}/${total} days${info}${progressStr}`;
      }
      return additionalInfo
        ? `[${methodPrefix}] Importing data: ${additionalInfo}${progressStr}`
        : `[${methodPrefix}] Importing data${progressStr}`;

    case ImportStatus.Uploading:
      if (hasProgress) {
        const currentMB = (current / (1024 * 1024)).toFixed(1);
        const totalMB = (total / (1024 * 1024)).toFixed(1);
        return `[${methodPrefix}] Uploading: ${currentMB}MB/${totalMB}MB${progressStr}`;
      }
      if (additionalInfo) {
        return `[${methodPrefix}] Uploading: ${additionalInfo}${progressStr}`;
      }
      return `[${methodPrefix}] Uploading${progressStr}`;

    case ImportStatus.Processing:
      if (hasProgress) {
        return `[${methodPrefix}] Processing: ${current}/${total} items${progressStr}`;
      }
      return `[${methodPrefix}] Processing${progressStr}`;

    case ImportStatus.CreatingDataDumpRequest:
      return `[${methodPrefix}] Creating Data Dump Request${progressStr}`;

    case ImportStatus.WaitingForDataDump:
      return `[${methodPrefix}] Waiting for Data Dump${progressStr}`;

    case ImportStatus.Downloading:
      if (additionalInfo) {
        return `[${methodPrefix}] Downloading: ${additionalInfo}${progressStr}`;
      }
      return `[${methodPrefix}] Downloading Data Dump${progressStr}`;

    case ImportStatus.FetchingMetadata:
      return `[${methodPrefix}] Fetching Metadata${progressStr}`;

    case ImportStatus.Completed:
      if (importedCount) {
        return `✓ [${methodPrefix}] Sucessfully Imported ${importedCount.toLocaleString()} days.`;
      }
      return `✓ [${methodPrefix}] Import completed successfully`;

    case ImportStatus.Failed:
      if (error) {
        return `✕ [${methodPrefix}] Import failed: ${error}`;
      }
      return `✕ [${methodPrefix}] Import failed`;

    default:
      return `[${methodPrefix}] ${baseStatus}`;
  }
}


export function updateJob(job: ImportJob, options: JobUpdateOptions): void {
  const oldProgress = job.progress;
  const oldProcessedCount = job.processedCount || 0;

  if (options.current !== undefined) {
    job.processedCount = options.current;
  }

  if (options.total !== undefined) {
    job.totalToProcess = options.total;
  }

  if (options.importedCount !== undefined) {
    job.importedCount = options.importedCount;
  }

  if (options.error !== undefined) {
    job.error = options.error;
  }

  if (
    options.current !== undefined &&
    options.total !== undefined &&
    options.total > 0
  ) {
    job.progress = Math.round((options.current / options.total) * 100);
  } else if (options.status === ImportStatus.Completed) {
    job.progress = 100;
  }

  if (options.status !== undefined) {
    job.status = options.status as ImportStatus;
    job.message = formatStatus(
      options.status as ImportStatus,
      job.type!,
      options.current,
      options.total,
      job.progress,
      options.additionalInfo,
      job.importedCount,
      job.error,
    );
  }

  activeJobs.set(job.id, job);

  if (
    options.status === ImportStatus.ProcessingHeartbeats &&
    options.current !== undefined &&
    options.total !== undefined &&
    options.total > 0 &&
    (oldProgress !== job.progress || oldProcessedCount !== job.processedCount)
  ) {
    handleLog(
      `[${getProvider(job.type!)!.config.logPrefix}] Job ${job.id} progress: ${job.processedCount}/${job.totalToProcess} days (${job.progress}%)`,
    );
  }
}

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

  private getOrCreateJob(
    jobId: string,
    userId: string,
    type: ImportMethod,
    fileName: string,
    totalToProcess?: number,
  ): ImportJob {
    let job = activeJobs.get(jobId);
    if (!job) {
      job = createInitialImportJob(jobId, userId, type, fileName);
      if (totalToProcess !== undefined) {
        job.totalToProcess = totalToProcess;
        job.processedCount = 0;
      }
      activeJobs.set(jobId, job);
    } else {
      updateJob(job, {
        status: ImportStatus.Processing,
      });
      if (totalToProcess !== undefined && !job.totalToProcess) {
        job.totalToProcess = totalToProcess;
        job.processedCount = 0;
        activeJobs.set(jobId, job);
      }
    }
    return job;
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
          `[worker] Worker ${workerId} error: ${error instanceof Error ? error.message : String(error)}`,
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
      (chunk) => chunk.status === WorkChunkStatus.PENDING,
    );

    if (pendingChunk) {
      pendingChunk.status = WorkChunkStatus.PROCESSING;
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
      const daysWithData =
        job.data.exportData?.days?.filter(
          (day: { heartbeats?: any[] }) => day.heartbeats && day.heartbeats.length > 0,
        ) || [];
      this.createWorkChunks(job, daysWithData, ImportMethod.WAKATIME_FILE);

      const firstChunk = Array.from(this.workChunks.values()).find(
        (chunk) => chunk.jobId === job.id && chunk.status === WorkChunkStatus.PENDING,
      );

      if (firstChunk) {
        firstChunk.status = WorkChunkStatus.PROCESSING;
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
      job.type === ImportMethod.WAKATIME_FILE &&
      job.data.exportData?.days &&
      job.data.exportData.days.length > 10
    );
  }

  private createWorkChunks(
    job: QueueJob,
    items: any[],
    dataType: ImportMethod,
  ): void {
    if (!job.allocatedWorkers || !items.length) return;

    const chunkSize = Math.ceil(items.length / job.allocatedWorkers);

    const existingJob = activeJobs.get(job.id);
    if (existingJob) {
      updateJob(existingJob, {
        status: ImportStatus.ProcessingHeartbeats,
        current: 0,
        total: items.length,
      });
    }

    this.completedChunks.set(job.id, new Set());

    for (let i = 0; i < job.allocatedWorkers; i++) {
      const start = i * chunkSize;
      const end = Math.min(start + chunkSize, items.length);

      if (start < items.length) {
        const chunk: WorkChunk = {
          id: `${job.id}-chunk-${i}`,
          jobId: job.id,
          type: WorkChunkType.DATE_RANGE,
          data:
            dataType === ImportMethod.WAKAPI || dataType === ImportMethod.CODETIME
              ? {
                  dates: items.slice(start, end),
                  heartbeatsByDate: job.data.heartbeatsByDate,
                  chunkIndex: i,
                  totalChunks: job.allocatedWorkers,
                  originalJob: job,
                  processedDays: 0,
                }
              : {
                  days: items.slice(start, end),
                  chunkIndex: i,
                  totalChunks: job.allocatedWorkers,
                  originalJob: job,
                  processedDays: 0,
                },
          status: WorkChunkStatus.PENDING,
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

      const jobType = chunk.data.originalJob?.type;
      const provider = jobType ? getProvider(jobType) : null;

      if (!provider) {
        throw new Error(`Unknown job type: ${jobType}`);
      }

      await provider.processChunk(chunk.data, job.userId);
      chunk.data.processedDays = (chunk.data.dates?.length || chunk.data.days?.length || 0);

      chunk.status = WorkChunkStatus.COMPLETED;
      chunk.progress = 100;

      const completedSet = this.completedChunks.get(chunk.jobId);
      if (completedSet) {
        completedSet.add(chunk.id);
      }

      this.updateJobProgress(chunk.jobId);
      await this.checkJobCompletion(chunk.jobId);
    } catch (error) {
      chunk.status = WorkChunkStatus.FAILED;
      handleLog(`Worker ${workerId} failed chunk ${chunk.id}: ${error}`);
    } finally {
      this.cleanupWorkerAssignment(workerId);
    }
  }

  private updateJobProgress(jobId: string): void {
    const job = activeJobs.get(jobId);
    if (!job) {
      handleLog(`[queue] Job ${jobId} not found for progress update`);
      return;
    }

    const jobChunks = Array.from(this.workChunks.values()).filter(
      (c) => c.jobId === jobId,
    );

    if (jobChunks.length === 0) {
      handleLog(`[${getProvider(job.type!)!.config.logPrefix}] No chunks found for job ${jobId}`);
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

    job.status = ImportStatus.ProcessingHeartbeats;
    job.message = formatStatus(
      ImportStatus.ProcessingHeartbeats,
      job.type!,
      job.processedCount,
      job.totalToProcess,
      job.progress,
      undefined,
      job.importedCount,
      job.error,
    );

    activeJobs.set(jobId, job);

    if (
      oldProgress !== job.progress ||
      oldProcessedCount !== job.processedCount
    ) {
      handleLog(
        `[${getProvider(job.type!)!.config.logPrefix}] Job ${jobId} progress: ${job.processedCount}/${job.totalToProcess} days (${job.progress}%)`,
      );
    }
  }

  private async checkJobCompletion(jobId: string): Promise<void> {
    const jobChunks = Array.from(this.workChunks.values()).filter(
      (c) => c.jobId === jobId,
    );
    const completedChunks = jobChunks.filter((c) => c.status === WorkChunkStatus.COMPLETED);

    if (completedChunks.length === jobChunks.length && jobChunks.length > 0) {
      const job = activeJobs.get(jobId);
      if (job) {
        const totalDaysWithData = jobChunks.reduce(
          (sum, chunk) => sum + (chunk.data.processedDays || 0),
          0,
        );

        updateJob(job, {
          status: ImportStatus.Completed,
          importedCount: totalDaysWithData,
        });
        handleLog(
          `[${getProvider(job.type!)!.config.logPrefix}] Job ${jobId} completed - processed ${totalDaysWithData} days across ${jobChunks.length} chunks`,
        );
      }

      jobChunks.forEach((chunk) => this.workChunks.delete(chunk.id));
      this.jobWorkerCount.delete(jobId);
      this.completedChunks.delete(jobId);
    }
  }

  private async processJob(job: QueueJob, workerId: number): Promise<void> {
    const provider = getProvider(job.type);

    if (!provider) {
      throw new Error(`Unknown job type: ${job.type}`);
    }

    const { displayName } = provider.config;

    try {
      provider.validateJob(job.data);

      const importJob = activeJobs.get(job.id) || this.getOrCreateJob(
        job.id,
        job.userId,
        job.type,
        `${displayName} Import ${new Date().toISOString()}`,
      );

      const result = await provider.processJob(job, importJob, {
        getOrCreateJob: this.getOrCreateJob.bind(this),
        updateJob,
        activeJobs,
        canParallelize: this.canParallelize.bind(this),
        createWorkChunks: this.createWorkChunks.bind(this),
      });

      const completedJob = activeJobs.get(job.id);
      if (completedJob && completedJob.status !== ImportStatus.Failed) {
        updateJob(completedJob, {
          status: ImportStatus.Completed,
          importedCount: result?.imported,
        });
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      handleLog(`Worker ${workerId} failed job ${job.id}: ${errorMessage}`);

      const failedJob = activeJobs.get(job.id);
      if (failedJob) {
        updateJob(failedJob, {
          status: ImportStatus.Failed,
          error: errorMessage,
        });
      } else {
        const newFailedJob: ImportJob = {
          id: job.id,
          fileName: `${job.type} Import ${new Date().toISOString()}`,
          message: "Failed",
          status: ImportStatus.Failed,
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
      chunk.status = success ? WorkChunkStatus.COMPLETED : WorkChunkStatus.FAILED;
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
      `[${getProvider(job.type!)!.config.logPrefix}] Added job ${job.id} (${job.type}) to queue. Queue length: ${this.queue.length}`,
    );
    return job.id;
  }

  getStatus() {
    const busyWorkerCount = this.workerJobAssignment.size;
    const activeJobsCount = Array.from(activeJobs.values()).filter(
      (job) =>
        job.status === ImportStatus.Processing || job.status === ImportStatus.ProcessingHeartbeats,
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
    const provider = getProvider(job.type);
    if (!provider) {
      throw new Error(`Job type ${job.type} not supported in worker threads`);
    }

    provider.validateJob(job.data);

    const importJob: ImportJob = {
      id: job.id,
      fileName: `${provider.config.displayName} Import`,
      status: ImportStatus.Processing,
      progress: 0,
      userId: job.userId,
      type: job.type,
    };

    result = await provider.processJob(job, importJob, {
      getOrCreateJob: () => importJob,
      updateJob: () => {},
      activeJobs: new Map(),
      canParallelize: () => false,
      createWorkChunks: () => {},
    });

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
  const jobType = chunk.data.originalJob?.type;
  const provider = jobType ? getProvider(jobType) : null;

  if (!provider) {
    parentPort?.postMessage({
      type: "error",
      error: `Unknown job type: ${jobType}`,
    });
    parentPort?.postMessage({
      type: "workComplete",
      data: { type: "chunk", chunkId: chunk.id, success: false },
    });
    return;
  }

  const itemCount = chunk.data.dates?.length || chunk.data.days?.length || 0;

  parentPort?.postMessage({
    type: "log",
    message: `Processing ${provider.config.displayName} chunk ${chunk.id} with ${itemCount} items`,
  });

  let success = false;

  try {
    await provider.processChunk(chunk.data, chunk.data.originalJob.userId);

    parentPort?.postMessage({
      type: "progress",
      data: { chunkId: chunk.id, progress: 100 },
    });

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

function createInitialImportJob(
  jobId: string,
  userId: string,
  type: ImportMethod,
  fileName: string,
): ImportJob {
  const { displayName } = getProvider(type)!.config;
  return {
    id: jobId,
    fileName,
    status: ImportStatus.Processing,
    message: `[${displayName}] Queued`,
    progress: 0,
    userId,
    type,
  };
}

export function queueImport(
  type: ImportMethod,
  userId: string,
  data: QueueJob["data"],
  existingJobId?: string,
): string {
  const jobId = existingJobId || randomUUID();
  const { displayName } = getProvider(type)!.config;

  if (!existingJobId) {
    const importJob = createInitialImportJob(
      jobId,
      userId,
      type,
      `${displayName} Import ${new Date().toISOString()}`,
    );
    activeJobs.set(jobId, importJob);
  }

  const job: QueueJob = {
    id: jobId,
    type,
    userId,
    data,
    createdAt: new Date(),
  };

  return importQueue.addJob(job);
}

export const getQueueStatus = () => importQueue.getStatus();

function sanitizeJobData(job: ImportJob): ImportJob {
  const sanitized = JSON.parse(
    JSON.stringify(job, (_key, value) => {
      if (typeof value === "bigint") {
        return value.toString();
      }
      return value;
    }),
  );

  return sanitized;
}

export const getAllJobStatuses = (userId?: string): ImportJob[] => {
  const jobs = Array.from(activeJobs.values());
  const filteredJobs = userId
    ? jobs.filter((job) => job.userId === userId)
    : jobs;
  return filteredJobs.map(sanitizeJobData);
};

export const getJobStatus = (jobId: string): ImportJob | undefined => {
  const job = activeJobs.get(jobId);
  return job ? sanitizeJobData(job) : undefined;
};
