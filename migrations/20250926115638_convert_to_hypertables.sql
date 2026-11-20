/*
  Warnings:

  - The primary key for the `Summaries` table will be changed. If it partially fails, the table could be left without primary key constraint.

*/
-- DropForeignKey
ALTER TABLE "public"."Heartbeats" DROP CONSTRAINT "Heartbeats_summariesId_fkey";

-- AlterTable
ALTER TABLE "public"."Summaries" DROP CONSTRAINT "Summaries_pkey",
ADD CONSTRAINT "Summaries_pkey" PRIMARY KEY ("id", "date");

-- CreateIndex
CREATE INDEX "Heartbeats_summariesId_idx" ON "public"."Heartbeats"("summariesId");

-- Convert to hypertables
CREATE EXTENSION IF NOT EXISTS timescaledb CASCADE;
SELECT create_hypertable('"Summaries"', 'date', migrate_data => true, chunk_time_interval => INTERVAL '2 weeks');
SELECT create_hypertable('"Heartbeats"', 'timestamp', migrate_data => true, chunk_time_interval => 604800000000);