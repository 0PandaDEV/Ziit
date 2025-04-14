-- AlterTable
ALTER TABLE "Heartbeat" ADD COLUMN     "branch" TEXT,
ADD COLUMN     "file" TEXT;

-- CreateIndex
CREATE INDEX "Heartbeat_branch_idx" ON "Heartbeat"("branch");

-- CreateIndex
CREATE INDEX "Heartbeat_file_idx" ON "Heartbeat"("file");
