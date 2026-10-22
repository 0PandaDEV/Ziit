import { prisma } from "~~/prisma/db";
import { recomputeSummariesForUser } from "~~/server/utils/summarize";
import {
  normalizeEditor,
  learnNames,
  normalizeKeys,
  normalizeLanguage,
  normalizeOs,
} from "~~/server/utils/normalize";

const LOCK_ID = 742400123;
const LOCK_TIMEOUT_MS = 6 * 60 * 60 * 1000;
const SUMMARY_PAGE = 1000;

type Fn = (value: string | null | undefined) => string | null;

function dirtyMap(values: Array<string | null>, fn: Fn) {
  const map: Record<string, string | null> = {};
  for (const value of values) {
    if (value === null) continue;
    const target = fn(value);
    if (target !== value) map[value] = target;
  }
  return map;
}

async function learnFromDatabase() {
  const [editors, languages, systems] = await Promise.all([
    prisma.$queryRaw<Array<{ value: string | null; count: bigint }>>`
      SELECT editor AS value, SUM(heartbeat_count) AS count
      FROM heartbeats_daily GROUP BY editor
    `,
    prisma.$queryRaw<Array<{ value: string | null; count: bigint }>>`
      SELECT language AS value, SUM(heartbeat_count) AS count
      FROM heartbeats_daily GROUP BY language
    `,
    prisma.$queryRaw<Array<{ value: string | null; count: bigint }>>`
      SELECT os AS value, SUM(heartbeat_count) AS count
      FROM heartbeats_daily GROUP BY os
    `,
  ]);

  const toRows = (rows: Array<{ value: string | null; count: bigint }>) =>
    rows.map((r) => ({ value: r.value, count: Number(r.count) }));

  learnNames("editor", toRows(editors));
  learnNames("language", toRows(languages));
  learnNames("os", toRows(systems));
}

async function backfillHeartbeats() {
  const chunks = await prisma.$queryRaw<
    Array<{ range_start: Date; range_end: Date; is_compressed: boolean }>
  >`
    SELECT range_start, range_end, is_compressed
    FROM timescaledb_information.chunks
    WHERE hypertable_name = 'Heartbeats'
    ORDER BY range_start
  `;

  let updated = 0;

  for (const chunk of chunks) {
    const combos = await prisma.$queryRaw<
      Array<{
        editor: string | null;
        language: string | null;
        os: string | null;
      }>
    >`
      SELECT DISTINCT editor, language, os
      FROM "Heartbeats"
      WHERE "timestamp" >= ${chunk.range_start.toISOString()}::timestamptz
        AND "timestamp" < ${chunk.range_end.toISOString()}::timestamptz
    `;

    const editors = dirtyMap(
      combos.map((c) => c.editor),
      normalizeEditor
    );
    const languages = dirtyMap(
      combos.map((c) => c.language),
      normalizeLanguage
    );
    const systems = dirtyMap(
      combos.map((c) => c.os),
      normalizeOs
    );

    const editorKeys = Object.keys(editors);
    const languageKeys = Object.keys(languages);
    const osKeys = Object.keys(systems);

    if (!editorKeys.length && !languageKeys.length && !osKeys.length) continue;

    const count = await prisma.$executeRaw`
      UPDATE "Heartbeats" SET
        editor = CASE
          WHEN editor IS NOT NULL AND ${JSON.stringify(editors)}::jsonb ? editor
          THEN ${JSON.stringify(editors)}::jsonb ->> editor
          ELSE editor
        END,
        language = CASE
          WHEN language IS NOT NULL AND ${JSON.stringify(languages)}::jsonb ? language
          THEN ${JSON.stringify(languages)}::jsonb ->> language
          ELSE language
        END,
        os = CASE
          WHEN os IS NOT NULL AND ${JSON.stringify(systems)}::jsonb ? os
          THEN ${JSON.stringify(systems)}::jsonb ->> os
          ELSE os
        END
      WHERE "timestamp" >= ${chunk.range_start.toISOString()}::timestamptz
        AND "timestamp" < ${chunk.range_end.toISOString()}::timestamptz
        AND (
          editor = ANY(${editorKeys}::text[])
          OR language = ANY(${languageKeys}::text[])
          OR os = ANY(${osKeys}::text[])
        )
    `;
    updated += count;
  }

  return updated;
}

async function backfillSummaries() {
  let cursorDate = "1970-01-01";
  let cursorId = "";
  let updated = 0;

  for (;;) {
    const rows = await prisma.$queryRaw<
      Array<{
        id: string;
        date: string;
        editors: unknown;
        languages: unknown;
        os: unknown;
      }>
    >`
      SELECT id, date::text AS date, editors, languages, os
      FROM "Summaries"
      WHERE (date, id) > (${cursorDate}::date, ${cursorId})
      ORDER BY date, id
      LIMIT ${SUMMARY_PAGE}
    `;

    if (!rows.length) break;

    for (const row of rows) {
      const editors = normalizeKeys(row.editors, normalizeEditor);
      const languages = normalizeKeys(row.languages, normalizeLanguage);
      const systems = normalizeKeys(row.os, normalizeOs);

      if (!editors.changed && !languages.changed && !systems.changed) continue;

      await prisma.$executeRaw`
        UPDATE "Summaries" SET
          editors = ${JSON.stringify(editors.value)}::jsonb,
          languages = ${JSON.stringify(languages.value)}::jsonb,
          os = ${JSON.stringify(systems.value)}::jsonb
        WHERE id = ${row.id} AND date = ${row.date}::date
      `;
      updated++;
    }

    const last = rows[rows.length - 1]!;
    cursorDate = last.date;
    cursorId = last.id;
  }

  return updated;
}

async function backfillStats() {
  const rows = await prisma.$queryRaw<
    Array<{
      id: string;
      topEditor: string;
      topLanguage: string;
      topOS: string;
    }>
  >`SELECT id, "topEditor", "topLanguage", "topOS" FROM "Stats"`;

  let updated = 0;
  for (const row of rows) {
    const topEditor = normalizeEditor(row.topEditor) ?? "Unknown";
    const topLanguage = normalizeLanguage(row.topLanguage) ?? "Unknown";
    const topOS = normalizeOs(row.topOS) ?? "Unknown";
    if (
      topEditor === row.topEditor &&
      topLanguage === row.topLanguage &&
      topOS === row.topOS
    )
      continue;
    await prisma.$executeRaw`
      UPDATE "Stats"
      SET "topEditor" = ${topEditor}, "topLanguage" = ${topLanguage}, "topOS" = ${topOS}
      WHERE id = ${row.id}
    `;
    updated++;
  }
  return updated;
}

async function rebuildQueuedSummaries() {
  const failed: string[] = [];
  let done = 0;

  for (;;) {
    const rows = await prisma.$queryRaw<Array<{ userId: string }>>`
      SELECT "userId" FROM "SummaryRebuild"
      WHERE "userId" <> ALL(${failed}::text[])
      LIMIT 1
    `;
    const userId = rows[0]?.userId;
    if (!userId) return done;

    try {
      await recomputeSummariesForUser(userId);
      await prisma.$executeRaw`
        DELETE FROM "SummaryRebuild" WHERE "userId" = ${userId}
      `;
      done++;
    } catch (error) {
      failed.push(userId);
      console.error(`[summaries] rebuild failed for ${userId}`, error);
    }
  }
}

async function refreshDailyAggregate() {
  await prisma.$executeRawUnsafe(
    `CALL refresh_continuous_aggregate('heartbeats_daily', NULL, NULL)`
  );
  await prisma.$executeRawUnsafe(
    `CALL refresh_admin_dashboard_stats(0, '{}'::jsonb)`
  );
  await prisma.$executeRawUnsafe(`
    SELECT add_continuous_aggregate_policy(
      'heartbeats_daily',
      start_offset => NULL,
      end_offset => INTERVAL '1 hour',
      schedule_interval => INTERVAL '30 minutes',
      if_not_exists => true
    )
  `);
}

async function reportUnmapped() {
  for (const column of ["editor", "language", "os"]) {
    const rows = await prisma.$queryRawUnsafe<
      Array<{ variants: string[] }>
    >(
      `SELECT array_agg(DISTINCT ${column}) AS variants
       FROM heartbeats_daily
       WHERE ${column} IS NOT NULL
       GROUP BY lower(${column})
       HAVING count(DISTINCT ${column}) > 1`
    );
    for (const row of rows) {
      console.warn(`[normalize] unmapped ${column} variants`, row.variants);
    }
  }
}

async function runMaintenance() {
  const started = Date.now();

  const ready = await prisma.$queryRaw<Array<{ ok: boolean }>>`
    SELECT (
      to_regclass('public.heartbeats_daily') IS NOT NULL
      AND to_regclass('public."SummaryRebuild"') IS NOT NULL
    ) AS ok
  `;
  if (!ready[0]?.ok) {
    console.warn("[normalize] skipped: run `prisma migrate deploy` first");
    return;
  }

  await learnFromDatabase();

  const heartbeats = await backfillHeartbeats();
  const summaries = await backfillSummaries();
  const stats = await backfillStats();
  console.log(
    `[normalize] heartbeats=${heartbeats} summaries=${summaries} stats=${stats}`
  );

  const rebuilt = await rebuildQueuedSummaries();
  if (rebuilt) console.log(`[summaries] rebuilt ${rebuilt} users`);

  await refreshDailyAggregate();
  await reportUnmapped();
  console.log(`[normalize] done in ${Date.now() - started}ms`);
}

export async function runDataMaintenance() {
  await prisma.$transaction(
    async (tx) => {
      const rows = await tx.$queryRaw<Array<{ locked: boolean }>>`
        SELECT pg_try_advisory_xact_lock(${LOCK_ID}::bigint) AS locked
      `;
      if (!rows[0]?.locked) return;
      await runMaintenance();
    },
    { timeout: LOCK_TIMEOUT_MS, maxWait: 10_000 }
  );
}
