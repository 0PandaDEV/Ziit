-- AlterTable
ALTER TABLE "Summaries" ADD COLUMN     "editors" JSONB,
ADD COLUMN     "languages" JSONB,
ADD COLUMN     "os" JSONB,
ADD COLUMN     "projects" JSONB;
