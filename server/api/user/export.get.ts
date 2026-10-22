import { H3Event } from "h3";
import { Readable } from "node:stream";
import { z } from "zod";
import { prisma } from "~~/prisma/db";
import { handleApiError } from "~~/server/utils/logging";

defineRouteMeta({
  openAPI: {
    tags: ["User"],
    summary: "Export user data",
    description:
      "Streams all heartbeats (and summaries for JSON) of the authenticated user as a JSON or CSV download.",
    parameters: [
      {
        in: "query",
        name: "format",
        required: false,
        schema: { type: "string", enum: ["json", "csv"], default: "json" },
      },
    ],
    responses: {
      200: { description: "File download" },
      400: { description: "Invalid format" },
      500: { description: "Failed to export data" },
    },
    operationId: "exportUserData",
  },
});

const querySchema = z.object({
  format: z.enum(["json", "csv"]).default("json"),
});

const PAGE_SIZE = 5000;

type HeartbeatRow = {
  id: string;
  cursor: string;
  timestamp: Date;
  project: string | null;
  editor: string | null;
  language: string | null;
  os: string | null;
  file: string | null;
  branch: string | null;
};

const CSV_COLUMNS = [
  "timestamp",
  "project",
  "editor",
  "language",
  "os",
  "file",
  "branch",
] as const;

function csvCell(value: string | null): string {
  if (value === null || value === undefined) return "";
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

async function* heartbeatPages(userId: string) {
  let cursorTs = "-infinity";
  let cursorId = "";

  for (;;) {
    const rows = await prisma.$queryRaw<HeartbeatRow[]>`
      SELECT id, "timestamp"::text AS cursor, "timestamp", project, editor,
             language, os, file, branch
      FROM "Heartbeats"
      WHERE "userId" = ${userId}
        AND ("timestamp", id) > (${cursorTs}::timestamptz, ${cursorId})
      ORDER BY "timestamp", id
      LIMIT ${PAGE_SIZE}
    `;

    if (!rows.length) return;
    yield rows;

    const last = rows[rows.length - 1]!;
    cursorTs = last.cursor;
    cursorId = last.id;
    if (rows.length < PAGE_SIZE) return;
  }
}

async function* csvStream(userId: string) {
  yield CSV_COLUMNS.join(",") + "\n";
  for await (const rows of heartbeatPages(userId)) {
    let chunk = "";
    for (const row of rows) {
      chunk +=
        [
          row.timestamp.toISOString(),
          csvCell(row.project),
          csvCell(row.editor),
          csvCell(row.language),
          csvCell(row.os),
          csvCell(row.file),
          csvCell(row.branch),
        ].join(",") + "\n";
    }
    yield chunk;
  }
}

async function* jsonStream(userId: string) {
  const [user, summaries] = await Promise.all([
    prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        githubUsername: true,
        leaderboardEnabled: true,
        createdAt: true,
      },
    }),
    prisma.summaries.findMany({
      where: { userId },
      orderBy: { date: "asc" },
      select: {
        date: true,
        totalMinutes: true,
        projects: true,
        languages: true,
        editors: true,
        os: true,
        files: true,
        branches: true,
      },
    }),
  ]);

  yield `{"version":1,"exportedAt":${JSON.stringify(new Date().toISOString())},`;
  yield `"user":${JSON.stringify(user)},`;
  yield `"summaries":${JSON.stringify(
    summaries.map((s) => ({ ...s, date: s.date.toISOString().slice(0, 10) }))
  )},`;
  yield `"heartbeats":[`;

  let first = true;
  for await (const rows of heartbeatPages(userId)) {
    let chunk = "";
    for (const row of rows) {
      chunk +=
        (first ? "" : ",") +
        JSON.stringify({
          timestamp: row.timestamp.toISOString(),
          project: row.project,
          editor: row.editor,
          language: row.language,
          os: row.os,
          file: row.file,
          branch: row.branch,
        });
      first = false;
    }
    yield chunk;
  }

  yield "]}";
}

export default defineEventHandler(async (event: H3Event) => {
  const userId = event.context.user.id as string;

  const parsed = querySchema.safeParse(getQuery(event));
  if (!parsed.success) {
    throw handleApiError(
      400,
      `Invalid export format requested by user ${userId}`,
      "Invalid export format"
    );
  }

  const { format } = parsed.data;
  const date = new Date().toISOString().slice(0, 10);

  setResponseHeaders(event, {
    "Content-Type":
      format === "json"
        ? "application/json; charset=utf-8"
        : "text/csv; charset=utf-8",
    "Content-Disposition": `attachment; filename="ziit-export-${date}.${format}"`,
    "Cache-Control": "no-store",
  });

  const source = format === "json" ? jsonStream(userId) : csvStream(userId);
  const stream = Readable.from(source);
  stream.on("error", (error) => {
    console.error(`Export stream failed for user ${userId}:`, error);
  });

  return sendStream(event, stream);
});
