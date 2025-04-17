/*
  Warnings:

  - The primary key for the `Heartbeats` table will be changed. If it partially fails, the table could be left without primary key constraint.

*/
-- CreateExtension
CREATE EXTENSION IF NOT EXISTS timescaledb CASCADE;
CREATE EXTENSION IF NOT EXISTS "pg_stat_statements";

-- DropIndex
DROP INDEX "Heartbeats_id_idx";

-- DropIndex
DROP INDEX "Heartbeats_timestamp_idx";

-- DropIndex
DROP INDEX "Heartbeats_userId_timestamp_idx";

-- AlterTable
ALTER TABLE "Heartbeats" DROP CONSTRAINT "Heartbeats_pkey",
ADD CONSTRAINT "Heartbeats_pkey" PRIMARY KEY ("id", "timestamp");

-- CreateIndex
CREATE INDEX "Heartbeats_userId_timestamp_idx" ON "Heartbeats"("userId", "timestamp" DESC);

-- CreateIndex
CREATE INDEX "Heartbeats_timestamp_idx" ON "Heartbeats"("timestamp" DESC);

-- CreateIndex
CREATE INDEX "Heartbeats_userId_project_timestamp_idx" ON "Heartbeats"("userId", "project", "timestamp" DESC);

-- CreateIndex
CREATE INDEX "Heartbeats_userId_language_timestamp_idx" ON "Heartbeats"("userId", "language", "timestamp" DESC);

-- CreateIndex
CREATE INDEX "Heartbeats_userId_editor_timestamp_idx" ON "Heartbeats"("userId", "editor", "timestamp" DESC);

-- CreateIndex
CREATE INDEX "Heartbeats_userId_os_timestamp_idx" ON "Heartbeats"("userId", "os", "timestamp" DESC);

-- CreateIndex
CREATE INDEX "Summaries_userId_date_idx" ON "Summaries"("userId", "date" DESC);

SELECT create_hypertable('"Heartbeats"', 'timestamp', if_not_exists => TRUE, migrate_data => TRUE);