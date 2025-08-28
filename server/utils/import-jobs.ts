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
