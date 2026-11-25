import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { isTimelineDay, timelineMonthBounds, type TimelineRange } from "@/lib/timeline-period";

type EventBase = { id: string; day: string; pageId: string; slug: string; title: string };
export type TimelineEvent = EventBase & (
  | { kind: "decision" | "discussion"; summary: string; evidence: string; version: number; explicitDate: boolean }
  | { kind: "document"; fromVersion: number; toVersion: number; created: boolean }
  | { kind: "comment"; count: number; commentId: string }
);

export type TimelineMonthSummary = {
  month: string;
  total: number;
  counts: Record<TimelineEvent["kind"], number>;
  highlights: TimelineEvent[];
};

type Bounds = Pick<TimelineRange, "from" | "to">;
const monthPageSize = 20;

// Prisma stores UTC instants in timestamp-without-time-zone columns. Apply
// calendar arithmetic only to bounds for filtering so the timestamp indexes
// remain usable. No revision or comment bodies enter the ranking/sort.
function activity(spaceId: string, { from, to }: Bounds) {
  const start = Prisma.sql`(${from}::date - INTERVAL '9 hours')`;
  const end = Prisma.sql`(${to}::date + INTERVAL '1 day' - INTERVAL '9 hours')`;
  const revisionDay = Prisma.sql`(r."createdAt" + INTERVAL '9 hours')::date`;
  const commentDay = Prisma.sql`(c."createdAt" + INTERVAL '9 hours')::date`;

  return Prisma.sql`
    WITH pages AS MATERIALIZED (
      SELECT id FROM "Page" WHERE "spaceId" = ${spaceId} AND "deletedAt" IS NULL
    ), events AS (
      SELECT 'entry:' || e.id AS id, e."pageId", e."eventDay" AS day, r."createdAt" AS "recordedAt",
        CASE WHEN e.kind = 'decision' THEN 0 ELSE 1 END AS priority,
        e.id AS "entryId", NULL::integer AS "firstVersion", e.version AS "lastVersion", 1 AS quantity
      FROM pages p JOIN "TimelineEntry" e ON e."pageId" = p.id
      JOIN "PageRevision" r ON r.id = e."revisionId" AND r."pageId" = e."pageId" AND r.version = e.version
      WHERE e."eventDay" BETWEEN ${from}::date AND ${to}::date
        AND NOT EXISTS (
          SELECT 1 FROM "TimelineEntry" earlier
          WHERE earlier."pageId" = e."pageId" AND earlier.fingerprint = e.fingerprint
            AND earlier.version < e.version
        )
      UNION ALL
      SELECT 'document:' || r."pageId" || ':' || to_char(${revisionDay}, 'YYYY-MM-DD'),
        r."pageId", ${revisionDay}, MAX(r."createdAt"), 2, NULL::text,
        MIN(r.version), MAX(r.version), COUNT(*)::integer
      FROM pages p JOIN "PageRevision" r ON r."pageId" = p.id
      WHERE r."createdAt" >= ${start} AND r."createdAt" < ${end}
      GROUP BY r."pageId", ${revisionDay}
      UNION ALL
      SELECT 'comment:' || c."pageId" || ':' || to_char(${commentDay}, 'YYYY-MM-DD'),
        c."pageId", ${commentDay}, MAX(c."createdAt"), 3, NULL::text,
        NULL::integer, NULL::integer, COUNT(*)::integer
      FROM pages p JOIN "Comment" c ON c."pageId" = p.id
      WHERE c."createdAt" >= ${start} AND c."createdAt" < ${end}
      GROUP BY c."pageId", ${commentDay}
    )`;
}

// Only the visible page of results is joined to titles, quotes and comment anchors.
const eventColumns = Prisma.sql`
  d.id, d."pageId", to_char(d.day, 'YYYY-MM-DD') AS day, d."recordedAt", d.priority,
  d."firstVersion", d."lastVersion", d.quantity, p.slug, COALESCE(r.title, p.title) AS title,
  e.summary, e.evidence, e."explicitDate", anchor.id AS "commentId"`;
const eventTables = Prisma.sql`
  FROM displayed d JOIN "Page" p ON p.id = d."pageId"
  LEFT JOIN "PageRevision" r ON r."pageId" = d."pageId" AND r.version = d."lastVersion"
  LEFT JOIN "TimelineEntry" e ON e.id = d."entryId"
  LEFT JOIN LATERAL (
    SELECT c.id FROM "Comment" c
    WHERE d.priority = 3 AND c."pageId" = d."pageId"
      AND c."createdAt" >= d.day - INTERVAL '9 hours'
      AND c."createdAt" < d.day + INTERVAL '1 day' - INTERVAL '9 hours'
    ORDER BY c."createdAt", c.id LIMIT 1
  ) anchor ON true`;

type RawEvent = EventBase & {
  recordedAt: Date;
  priority: 0 | 1 | 2 | 3;
  firstVersion: number | null;
  lastVersion: number | null;
  quantity: number;
  summary: string | null;
  evidence: string | null;
  explicitDate: boolean | null;
  commentId: string | null;
};

function eventFromRow(row: RawEvent): TimelineEvent {
  const { id, day, pageId, slug, title } = row;
  const base = { id, day, pageId, slug, title };
  if (row.priority === 3) return { ...base, kind: "comment", count: row.quantity, commentId: row.commentId! };
  if (row.priority === 2) return {
    ...base, kind: "document", fromVersion: Math.max(1, row.firstVersion! - 1),
    toVersion: row.lastVersion!, created: row.firstVersion === 1,
  };
  return {
    ...base, kind: row.priority === 0 ? "decision" : "discussion",
    summary: row.summary!, evidence: row.evidence!, explicitDate: row.explicitDate!, version: row.lastVersion!,
  };
}

/** The caller must establish current viewer access before passing the space ID. */
export async function getTimelineOverview(spaceId: string, range: TimelineRange): Promise<TimelineMonthSummary[]> {
  type OverviewRow = RawEvent & { month: string; decisions: number; discussions: number; documents: number; comments: number };
  const rows = await prisma.$queryRaw<OverviewRow[]>(Prisma.sql`
    ${activity(spaceId, range)}, candidates AS (
      SELECT events.*, to_char(day, 'YYYY-MM') AS month,
        ROW_NUMBER() OVER (
          PARTITION BY date_trunc('month', day::timestamp), priority, "pageId"
          ORDER BY day DESC, "recordedAt" DESC, id DESC
        ) AS "documentRank"
      FROM events
    ), ranked AS (
      SELECT candidates.*,
        ROW_NUMBER() OVER (
          PARTITION BY month ORDER BY priority, ("documentRank" = 1) DESC, day DESC, "recordedAt" DESC, id DESC
        ) AS position,
        (COUNT(*) FILTER (WHERE priority = 0) OVER month_window)::integer AS decisions,
        (COUNT(*) FILTER (WHERE priority = 1) OVER month_window)::integer AS discussions,
        (COUNT(*) FILTER (WHERE priority = 2) OVER month_window)::integer AS documents,
        (COUNT(*) FILTER (WHERE priority = 3) OVER month_window)::integer AS comments
      FROM candidates WINDOW month_window AS (PARTITION BY month)
    ), displayed AS MATERIALIZED (
      SELECT * FROM ranked WHERE position <= 3
    )
    SELECT ${eventColumns}, d.month, d.decisions, d.discussions, d.documents, d.comments
    ${eventTables} ORDER BY d.month DESC, d.position
  `);
  const months: TimelineMonthSummary[] = [];
  for (const row of rows) {
    let month = months.at(-1);
    if (month?.month !== row.month) {
      const counts = { decision: row.decisions, discussion: row.discussions, document: row.documents, comment: row.comments };
      month = { month: row.month, counts, total: row.decisions + row.discussions + row.documents + row.comments, highlights: [] };
      months.push(month);
    }
    month.highlights.push(eventFromRow(row));
  }
  return months;
}

function detailCursor(spaceId: string, bounds: Bounds, encoded?: string) {
  if (!encoded || encoded.length > 2048 || !/^[\w-]+$/.test(encoded)) return null;
  try {
    const raw = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
    if (!Array.isArray(raw) || raw.length !== 6) return null;
    const [space, from, to, day, recordedAt, id] = raw;
    if (space !== spaceId || from !== bounds.from || to !== bounds.to ||
        typeof day !== "string" || !isTimelineDay(day) || day < from || day > to ||
        typeof id !== "string" || !id || id.includes("\0") || !id.isWellFormed() ||
        typeof recordedAt !== "string" || !isTimelineDay(recordedAt.slice(0, 10)) ||
        new Date(recordedAt).toISOString() !== recordedAt) return null;
    return { day, recordedAt, id };
  } catch {
    return null;
  }
}

export async function getTimelineMonth(spaceId: string, range: TimelineRange, month: string, cursor?: string) {
  const bounds = timelineMonthBounds(range, month);
  if (!bounds) return { items: [], nextCursor: null };
  const after = detailCursor(spaceId, bounds, cursor);
  const rows = await prisma.$queryRaw<RawEvent[]>(Prisma.sql`
    ${activity(spaceId, bounds)}, displayed AS MATERIALIZED (
      SELECT * FROM events
      ${after ? Prisma.sql`WHERE (day, "recordedAt", id) < (${after.day}::date, ${after.recordedAt}::timestamp, ${after.id})` : Prisma.empty}
      ORDER BY day DESC, "recordedAt" DESC, id DESC LIMIT ${monthPageSize + 1}
    )
    SELECT ${eventColumns} ${eventTables} ORDER BY d.day DESC, d."recordedAt" DESC, d.id DESC
  `);
  const visible = rows.slice(0, monthPageSize);
  const last = visible.at(-1);
  const nextCursor = rows.length > monthPageSize && last
    ? Buffer.from(JSON.stringify([spaceId, bounds.from, bounds.to, last.day, last.recordedAt.toISOString(), last.id])).toString("base64url")
    : null;
  return { items: visible.map(eventFromRow), nextCursor };
}
