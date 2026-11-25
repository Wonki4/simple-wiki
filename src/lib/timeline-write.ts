import { prisma } from "./db";
import { JsonInputError } from "./bounded-json";
import { isTimelineDay, kstDayEnd, kstDayStart } from "./timeline-period";
import { timelineRows, type TimelineWriteInput } from "./timeline-write-input";

export async function saveTimeline(spaceId: string, slug: string, { version, entries }: TimelineWriteInput) {
  return prisma.$transaction(async tx => {
    // Serializes concurrent replacements and ensures a trash operation cannot interleave.
    const [page] = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM "Page" WHERE "spaceId" = ${spaceId} AND slug = ${slug} AND "deletedAt" IS NULL FOR UPDATE
    `;
    if (!page) return null;
    const revision = await tx.pageRevision.findUnique({
      where: { pageId_version: { pageId: page.id, version } },
      select: { id: true, pageId: true, version: true, createdAt: true, title: true, content: true },
    });
    if (!revision) return null;
    const rows = timelineRows(revision, entries);
    const review = { revisionId: revision.id };
    await tx.timelineReview.upsert({ where: review, create: review, update: {} });
    await tx.timelineEntry.deleteMany({ where: review });
    if (rows.length) await tx.timelineEntry.createMany({ data: rows });
    return { version, count: rows.length };
  });
}

type SourceKey = { createdAt: Date; id: string };

function decodeCursor(value: string, spaceId: string, from: string, to: string): SourceKey {
  try {
    if (value.length > 1024 || !/^[\w-]+$/.test(value)) throw new Error();
    const parsed: unknown = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
    if (!Array.isArray(parsed) || parsed.length !== 5) throw new Error();
    const [space, start, end, date, id] = parsed;
    if (space !== spaceId || start !== from || end !== to || typeof date !== "string" ||
      typeof id !== "string" || !id || id.length > 128 || id.includes("\0") || !id.isWellFormed()) throw new Error();
    const createdAt = new Date(date);
    if (createdAt.toISOString() !== date) throw new Error();
    return { createdAt, id };
  } catch {
    throw new JsonInputError("현재 스페이스와 기간에 해당하는 커서가 필요합니다.");
  }
}

export async function listTimelineSources(spaceId: string, params: URLSearchParams) {
  const from = params.get("from") ?? "";
  const to = params.get("to") ?? "";
  if (!isTimelineDay(from) || !isTimelineDay(to) || from > to) throw new JsonInputError("조회 시작일과 종료일을 확인하세요.");
  const limitParam = params.get("limit") ?? "5";
  if (!/^(?:[1-9]|1[0-9]|20)$/.test(limitParam)) throw new JsonInputError("limit은 1~20 사이의 정수여야 합니다.");
  const limit = Number(limitParam);
  const token = params.get("cursor");
  const cursor = token === null ? null : decodeCursor(token, spaceId, from, to);
  const rows = await prisma.pageRevision.findMany({
    where: {
      page: { spaceId, deletedAt: null }, timelineReview: null,
      createdAt: { gte: kstDayStart(from), lt: kstDayEnd(to) },
      ...(cursor && { OR: [
        { createdAt: { gt: cursor.createdAt } },
        { createdAt: cursor.createdAt, id: { gt: cursor.id } },
      ] }),
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }], take: limit + 1,
    select: { id: true, title: true, version: true, createdAt: true, page: { select: { slug: true } } },
  });
  const last = rows[limit - 1];
  const nextCursor = rows.length > limit
    ? Buffer.from(JSON.stringify([spaceId, from, to, last.createdAt.toISOString(), last.id])).toString("base64url")
    : null;
  const sources = rows.slice(0, limit).map(row => ({
    slug: row.page.slug, title: row.title, version: row.version, recordedAt: row.createdAt.toISOString(),
  }));
  return { sources, nextCursor };
}
