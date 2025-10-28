-- Migration to convert Heartbeats timestamp from bigint to proper TIMESTAMPTZ
-- and ensure full alignment with Prisma schema while preserving data

-- 1. Ensure TimescaleDB extension is available
CREATE EXTENSION IF NOT EXISTS timescaledb CASCADE;

-- 2. Create backup table to preserve existing data
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'Heartbeats' AND table_schema = 'public') THEN
        -- Create backup table with all data
        CREATE TABLE "Heartbeats_backup" AS SELECT * FROM "Heartbeats";
        RAISE NOTICE 'Created backup table with % rows', (SELECT COUNT(*) FROM "Heartbeats_backup");
    END IF;
END $$;

-- 3. Drop the old table/hypertable completely
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'Heartbeats' AND table_schema = 'public') THEN
        BEGIN
            -- Try to drop as hypertable first
            PERFORM drop_hypertable('"Heartbeats"');
            RAISE NOTICE 'Dropped hypertable Heartbeats';
        EXCEPTION
            WHEN OTHERS THEN
                -- If that fails, drop as regular table
                DROP TABLE "Heartbeats" CASCADE;
                RAISE NOTICE 'Dropped regular table Heartbeats';
        END;
    END IF;
END $$;

-- 4. Create the new table with exact schema matching Prisma model
CREATE TABLE "Heartbeats" (
    "id" TEXT NOT NULL,
    "timestamp" TIMESTAMPTZ NOT NULL,
    "userId" TEXT NOT NULL,
    "project" TEXT,
    "editor" TEXT,
    "language" TEXT,
    "os" TEXT,
    "file" TEXT,
    "branch" TEXT,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
    "summariesId" TEXT,

    CONSTRAINT "Heartbeats_pkey" PRIMARY KEY ("id", "timestamp")
);

-- 5. Restore data from backup with proper timestamp conversion
DO $$
DECLARE
    backup_exists boolean;
    timestamp_type text;
BEGIN
    -- Check if backup table exists
    SELECT EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_name = 'Heartbeats_backup' AND table_schema = 'public'
    ) INTO backup_exists;

    IF backup_exists THEN
        -- Check the data type of timestamp column in backup
        SELECT data_type INTO timestamp_type
        FROM information_schema.columns
        WHERE table_name = 'Heartbeats_backup'
        AND column_name = 'timestamp'
        AND table_schema = 'public';

        RAISE NOTICE 'Backup timestamp column type: %', timestamp_type;

        -- Insert data with appropriate conversion based on column type
        IF timestamp_type = 'bigint' THEN
            -- Convert bigint milliseconds to timestamptz
            INSERT INTO "Heartbeats" ("id", "timestamp", "userId", "project", "editor", "language", "os", "file", "branch", "createdAt", "summariesId")
            SELECT
                "id",
                to_timestamp("timestamp"::double precision / 1000) AT TIME ZONE 'UTC',
                "userId",
                "project",
                "editor",
                "language",
                "os",
                "file",
                "branch",
                COALESCE("createdAt", now()),
                "summariesId"
            FROM "Heartbeats_backup";
        ELSE
            -- Timestamp is already in timestamp/timestamptz format
            INSERT INTO "Heartbeats" ("id", "timestamp", "userId", "project", "editor", "language", "os", "file", "branch", "createdAt", "summariesId")
            SELECT
                "id",
                "timestamp"::timestamptz,
                "userId",
                "project",
                "editor",
                "language",
                "os",
                "file",
                "branch",
                COALESCE("createdAt", now()),
                "summariesId"
            FROM "Heartbeats_backup";
        END IF;

        RAISE NOTICE 'Restored % rows to new Heartbeats table', (SELECT COUNT(*) FROM "Heartbeats");
    END IF;
END $$;

-- 6. Create hypertable with migrate_data parameter
SELECT create_hypertable('"Heartbeats"', 'timestamp', chunk_time_interval => INTERVAL '1 week', migrate_data => true);

-- 7. Create all indexes as specified in Prisma schema (conditionally)
DO $$
BEGIN
    -- Drop any existing indexes first to avoid conflicts
    DROP INDEX IF EXISTS "Heartbeats_userId_timestamp_idx";
    DROP INDEX IF EXISTS "Heartbeats_timestamp_idx";
    DROP INDEX IF EXISTS "Heartbeats_userId_project_timestamp_idx";
    DROP INDEX IF EXISTS "Heartbeats_userId_language_timestamp_idx";
    DROP INDEX IF EXISTS "Heartbeats_userId_editor_timestamp_idx";
    DROP INDEX IF EXISTS "Heartbeats_userId_os_timestamp_idx";
    DROP INDEX IF EXISTS "Heartbeats_branch_idx";
    DROP INDEX IF EXISTS "Heartbeats_file_idx";
    DROP INDEX IF EXISTS "Heartbeats_summariesId_idx";

    -- Create all indexes
    CREATE INDEX "Heartbeats_userId_timestamp_idx" ON "Heartbeats"("userId", "timestamp" DESC);
    CREATE INDEX "Heartbeats_timestamp_idx" ON "Heartbeats"("timestamp" DESC);
    CREATE INDEX "Heartbeats_userId_project_timestamp_idx" ON "Heartbeats"("userId", "project", "timestamp" DESC);
    CREATE INDEX "Heartbeats_userId_language_timestamp_idx" ON "Heartbeats"("userId", "language", "timestamp" DESC);
    CREATE INDEX "Heartbeats_userId_editor_timestamp_idx" ON "Heartbeats"("userId", "editor", "timestamp" DESC);
    CREATE INDEX "Heartbeats_userId_os_timestamp_idx" ON "Heartbeats"("userId", "os", "timestamp" DESC);
    CREATE INDEX "Heartbeats_branch_idx" ON "Heartbeats"("branch");
    CREATE INDEX "Heartbeats_file_idx" ON "Heartbeats"("file");
    CREATE INDEX "Heartbeats_summariesId_idx" ON "Heartbeats"("summariesId");

    RAISE NOTICE 'Created all indexes successfully';
END $$;

-- 8. Add foreign key constraint
ALTER TABLE "Heartbeats" ADD CONSTRAINT "Heartbeats_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- 9. Clean up backup table
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'Heartbeats_backup' AND table_schema = 'public') THEN
        DROP TABLE "Heartbeats_backup";
        RAISE NOTICE 'Cleaned up backup table';
    END IF;
END $$;
