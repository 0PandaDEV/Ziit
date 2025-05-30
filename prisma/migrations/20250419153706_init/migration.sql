-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "pg_stat_statements";

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT,
    "githubId" TEXT,
    "githubUsername" TEXT,
    "githubAccessToken" TEXT,
    "apiKey" TEXT NOT NULL,
    "keystrokeTimeout" INTEGER NOT NULL DEFAULT 5,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Heartbeats" (
    "id" TEXT NOT NULL,
    "timestamp" BIGINT NOT NULL,
    "userId" TEXT NOT NULL,
    "project" TEXT,
    "editor" TEXT,
    "language" TEXT,
    "os" TEXT,
    "file" TEXT,
    "branch" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "summariesId" TEXT,

    CONSTRAINT "Heartbeats_pkey" PRIMARY KEY ("id","timestamp")
);

-- CreateTable
CREATE TABLE "Summaries" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "totalMinutes" INTEGER NOT NULL,
    "projects" JSONB,
    "languages" JSONB,
    "editors" JSONB,
    "os" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Summaries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "User_githubId_key" ON "User"("githubId");

-- CreateIndex
CREATE UNIQUE INDEX "User_apiKey_key" ON "User"("apiKey");

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
CREATE INDEX "Heartbeats_branch_idx" ON "Heartbeats"("branch");

-- CreateIndex
CREATE INDEX "Heartbeats_file_idx" ON "Heartbeats"("file");

-- CreateIndex
CREATE INDEX "Summaries_userId_date_idx" ON "Summaries"("userId", "date" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "Summaries_userId_date_key" ON "Summaries"("userId", "date");

-- AddForeignKey
ALTER TABLE "Heartbeats" ADD CONSTRAINT "Heartbeats_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Heartbeats" ADD CONSTRAINT "Heartbeats_summariesId_fkey" FOREIGN KEY ("summariesId") REFERENCES "Summaries"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Summaries" ADD CONSTRAINT "Summaries_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
