-- AlterTable
ALTER TABLE "public"."User" ADD COLUMN     "leaderboardFirstSet" BOOLEAN NOT NULL DEFAULT false,
ALTER COLUMN "leaderboardEnabled" SET DEFAULT false;
