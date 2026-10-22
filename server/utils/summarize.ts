import { randomUUID } from "node:crypto";
import { prisma } from "~~/prisma/db";
import {
  normalizeEditor,
  normalizeLanguage,
  normalizeOs,
} from "~~/server/utils/normalize";

const INSERT_BATCH_SIZE = 2000;

type SummaryRow = {
  heartbeat_count: bigint;
  total_minutes: number;
  projects: unknown;
  languages: unknown;
  editors: unknown;
  os: unknown;
  files: unknown;
  branches: unknown;
};

function utcDayBounds(dateStr: string) {
  const start = new Date(`${dateStr}T00:00:00.000Z`);
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  return { start, end };
}

function utcToday() {
  const now = new Date();
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
  );
}

export async function summarizeDay(userId: string, dateStr: string) {
  const rows = await prisma.$queryRaw<SummaryRow[]>`
    SELECT * FROM compute_day_summary(${userId}, ${dateStr}::date)
  `;
  const row = rows[0];
  if (!row || Number(row.heartbeat_count) === 0) return null;

  const saved = await prisma.$queryRaw<Array<{ id: string }>>`
    INSERT INTO "Summaries" (
      id, "userId", date, "totalMinutes",
      projects, languages, editors, os, files, branches
    )
    VALUES (
      ${randomUUID()}, ${userId}, ${dateStr}::date, ${row.total_minutes},
      ${JSON.stringify(row.projects)}::jsonb,
      ${JSON.stringify(row.languages)}::jsonb,
      ${JSON.stringify(row.editors)}::jsonb,
      ${JSON.stringify(row.os)}::jsonb,
      ${JSON.stringify(row.files)}::jsonb,
      ${JSON.stringify(row.branches)}::jsonb
    )
    ON CONFLICT ("userId", date) DO UPDATE SET
      "totalMinutes" = EXCLUDED."totalMinutes",
      projects = EXCLUDED.projects,
      languages = EXCLUDED.languages,
      editors = EXCLUDED.editors,
      os = EXCLUDED.os,
      files = EXCLUDED.files,
      branches = EXCLUDED.branches
    RETURNING id
  `;

  const summaryId = saved[0]!.id;
  const { start, end } = utcDayBounds(dateStr);

  await prisma.$executeRaw`
    UPDATE "Heartbeats"
    SET "summariesId" = ${summaryId}
    WHERE "userId" = ${userId}
      AND "timestamp" >= ${start.toISOString()}::timestamptz
      AND "timestamp" < ${end.toISOString()}::timestamptz
      AND "summariesId" IS DISTINCT FROM ${summaryId}
  `;

  return { id: summaryId, totalMinutes: row.total_minutes };
}

async function insertNewHeartbeats(
  userId: string,
  dateStr: string,
  heartbeats: any[]
) {
  const { start, end } = utcDayBounds(dateStr);

  const existing = await prisma.heartbeats.findMany({
    where: { userId, timestamp: { gte: start, lt: end } },
    select: { timestamp: true, file: true },
  });

  const seen = new Set(
    existing.map((h) => `${h.timestamp.getTime()}-${h.file || ""}`)
  );

  const fresh = heartbeats.filter(
    (h) => !seen.has(`${new Date(h.timestamp).getTime()}-${h.file || ""}`)
  );

  for (let i = 0; i < fresh.length; i += INSERT_BATCH_SIZE) {
    const batch = fresh.slice(i, i + INSERT_BATCH_SIZE);
    await prisma.heartbeats.createMany({
      data: batch.map((h) => ({
        userId,
        timestamp: new Date(h.timestamp),
        project: h.project,
        language: normalizeLanguage(h.language),
        editor: normalizeEditor(h.editor),
        os: normalizeOs(h.os),
        branch: h.branch,
        file: h.file,
      })),
      skipDuplicates: true,
    });
  }

  return fresh.length;
}

export async function createOrUpdateSummary(
  userId: string,
  dateStr: string,
  heartbeats: any[]
) {
  if (heartbeats.length === 0) return null;

  try {
    await insertNewHeartbeats(userId, dateStr, heartbeats);

    if (utcDayBounds(dateStr).start.getTime() >= utcToday().getTime()) {
      return null;
    }

    return await summarizeDay(userId, dateStr);
  } catch (error) {
    console.error(`Error saving data for ${dateStr}:`, error);
    return null;
  }
}

export async function processHeartbeatsByDate(
  userId: string,
  heartbeats: any[]
) {
  if (heartbeats.length === 0) return;

  const heartbeatsByDate = new Map<string, any[]>();

  heartbeats.forEach((heartbeat) => {
    const dateKey = new Date(heartbeat.timestamp).toISOString().split("T")[0]!;

    if (!heartbeatsByDate.has(dateKey)) {
      heartbeatsByDate.set(dateKey, []);
    }

    heartbeatsByDate.get(dateKey)!.push(heartbeat);
  });

  for (const [dateStr, dateHeartbeats] of heartbeatsByDate.entries()) {
    await createOrUpdateSummary(userId, dateStr, dateHeartbeats);
  }
}

export async function summarizePendingDays(batchSize = 500) {
  const today = utcToday();
  const processed = new Set<string>();
  let count = 0;

  for (;;) {
    const pending = await prisma.$queryRaw<
      Array<{ userId: string; day: string }>
    >`
      SELECT DISTINCT
        h."userId",
        to_char((h."timestamp" AT TIME ZONE 'UTC')::date, 'YYYY-MM-DD') AS day
      FROM "Heartbeats" h
      WHERE h."timestamp" < ${today.toISOString()}::timestamptz
        AND h."summariesId" IS NULL
      ORDER BY day
      LIMIT ${batchSize}
    `;

    const todo = pending.filter((p) => !processed.has(`${p.userId}:${p.day}`));
    if (!todo.length) return count;

    for (const { userId, day } of todo) {
      processed.add(`${userId}:${day}`);
      try {
        await summarizeDay(userId, day);
        count++;
      } catch (error) {
        console.error(`Error summarizing ${day} for ${userId}:`, error);
      }
    }
  }
}

export async function recomputeSummariesForUser(userId: string) {
  const today = utcToday();

  const days = await prisma.$queryRaw<Array<{ day: string }>>`
    SELECT DISTINCT to_char((h."timestamp" AT TIME ZONE 'UTC')::date, 'YYYY-MM-DD') AS day
    FROM "Heartbeats" h
    WHERE h."userId" = ${userId} AND h."timestamp" < ${today.toISOString()}::timestamptz
    ORDER BY day
  `;

  for (const { day } of days) {
    await summarizeDay(userId, day);
  }

  await prisma.$executeRaw`
    DELETE FROM "Summaries"
    WHERE "userId" = ${userId}
      AND date < ${today.toISOString().slice(0, 10)}::date
      AND date <> ALL(${days.map((d) => d.day)}::date[])
  `;

  return days.length;
}

export async function regenerateSummariesForUser(userId: string) {
  try {
    await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`DELETE FROM "Summaries" WHERE "userId" = ${userId}`;
      await tx.$executeRaw`
        UPDATE "Heartbeats" SET "summariesId" = NULL WHERE "userId" = ${userId}
      `;
    });

    await recomputeSummariesForUser(userId);

    const summariesCount = await prisma.summaries.count({
      where: { userId },
    });

    return {
      success: true,
      message: `Regenerated ${summariesCount} summaries`,
      summariesCount,
    };
  } catch (error) {
    console.error(
      "Regenerate summaries error:",
      error instanceof Error ? error.message : "Unknown error"
    );
    throw createError({
      statusCode: 69,
      message: "Failed to regenerate summaries",
    });
  }
}
