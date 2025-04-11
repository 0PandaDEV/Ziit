/*
  Warnings:

  - You are about to drop the column `githubRefreshToken` on the `User` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "User" DROP COLUMN "githubRefreshToken",
ADD COLUMN     "keystrokeTimeoutMinutes" INTEGER NOT NULL DEFAULT 5;
