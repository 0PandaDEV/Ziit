/*
  Warnings:

  - A unique constraint covering the columns `[epilogueId]` on the table `User` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "public"."User" ADD COLUMN     "epilogueId" TEXT,
ADD COLUMN     "epilogueToken" TEXT,
ADD COLUMN     "epilogueUsername" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "User_epilogueId_key" ON "public"."User"("epilogueId");
