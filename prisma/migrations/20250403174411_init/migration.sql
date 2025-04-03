-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT,
    "githubId" TEXT,
    "githubUsername" TEXT,
    "githubAccessToken" TEXT,
    "githubRefreshToken" TEXT,
    "apiKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Heartbeat" (
    "id" TEXT NOT NULL,
    "timestamp" TIMESTAMPTZ(6) NOT NULL,
    "userId" TEXT NOT NULL,
    "project" TEXT,
    "language" TEXT,
    "file" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Heartbeat_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DailyProjectSummary" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "project" TEXT NOT NULL,
    "totalSeconds" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DailyProjectSummary_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "User_githubId_key" ON "User"("githubId");

-- CreateIndex
CREATE UNIQUE INDEX "User_apiKey_key" ON "User"("apiKey");

-- CreateIndex
CREATE INDEX "Heartbeat_userId_timestamp_idx" ON "Heartbeat"("userId", "timestamp");

-- CreateIndex
CREATE INDEX "Heartbeat_timestamp_idx" ON "Heartbeat"("timestamp");

-- CreateIndex
CREATE UNIQUE INDEX "DailyProjectSummary_userId_date_project_key" ON "DailyProjectSummary"("userId", "date", "project");

-- AddForeignKey
ALTER TABLE "Heartbeat" ADD CONSTRAINT "Heartbeat_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
