-- CreateTable
CREATE TABLE "Stats" (
    "id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "totalHours" INTEGER NOT NULL,
    "totalUsers" BIGINT NOT NULL,
    "totalHeartbeats" INTEGER NOT NULL,
    "topEditor" TEXT NOT NULL,
    "topLanguage" TEXT NOT NULL,
    "topOS" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Stats_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Stats_date_key" ON "Stats"("date");
