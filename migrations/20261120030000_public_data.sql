ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "publicData" BOOLEAN NOT NULL DEFAULT false;
UPDATE "User" SET "publicData" = true;
