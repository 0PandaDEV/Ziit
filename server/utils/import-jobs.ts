export interface ImportJob {
  id: string;
  fileName: string;
  status: "Downloading" | "Processing" | "Completed" | "Failed" | "Pending";
  progress: number;
  importedCount?: number;
  error?: string;
  userId: string;
  totalSize?: number;
  uploadedSize?: number;
  processedCount?: number;
  totalToProcess?: number;
}

export const activeJobs = new Map<string, ImportJob>();
