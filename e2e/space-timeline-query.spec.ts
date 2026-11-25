import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { prisma } from "../src/lib/db";
import { getTimelineMonth, getTimelineOverview } from "../src/lib/space-timeline";
import { resolveTimelineRange } from "../src/lib/timeline-period";
import { saveTimeline } from "../src/lib/timeline-write";

test.afterAll(() => prisma.$disconnect());

test("월 대표에는 다른 문서의 결정이 우선되고, 같은 시각의 20건 이상을 빠짐없이 이어서 읽는다", async () => {
  const key = "timeline-query-" + randomUUID();
  const space = await prisma.space.create({ data: { key, name: "월별 집계 테스트", visibility: "restricted" } });
  const otherKey = key + "-other";
  try {
    const other = await prisma.space.create({ data: { key: otherKey, name: "다른 스페이스", visibility: "restricted" } });
    async function revision(slug: string, recordedAt: string, content = "", spaceId = space.id) {
      await prisma.page.create({ data: {
        spaceId, slug, title: slug, content, createdById: key, updatedById: key,
        revisions: { create: { version: 1, title: slug, content, authorId: key, createdAt: new Date(recordedAt) } },
      } });
    }
    await revision("outside-start", "2023-06-01T14:59:59.999Z");
    await revision("inside-start", "2023-06-01T15:00:00Z");
    await revision("inside-end", "2026-06-01T14:59:59.999Z");
    await revision("outside-end", "2026-06-01T15:00:00Z");
    await revision("other-space", "2026-05-06T11:00:00Z", "", other.id);

    for (const [index, slug] of ["A", "B", "C"].entries()) {
      const date = ["2026-05-10", "2026-05-09", "2026-05-08"][index];
      const decisions = Array.from({ length: index === 0 ? 22 : 1 }, (_, i) => ({
        kind: "decision" as const, summary: `${slug} 결정 ${i}`, evidence: `조치 ${i}를 채택했다.`, date,
      }));
      const entries = [...decisions, { kind: "discussion" as const, summary: "후속 논의", evidence: "후속 작업을 제안했다.", date }];
      await revision(slug, "2026-05-15T04:00:00Z", [date, ...entries.map(entry => entry.evidence)].join("\n"));
      await saveTimeline(space.id, slug, { version: 1, entries });
    }

    const range = resolveTimelineRange({ period: "3y", to: "2026-06-01" })!;
    const overview = await getTimelineOverview(space.id, range);
    expect(overview.map(month => month.month)).toEqual(["2026-06", "2026-05", "2023-06"]);
    expect(overview[0].highlights.map(e => e.slug)).toEqual(["inside-end"]);
    expect(overview[2].highlights.map(e => e.slug)).toEqual(["inside-start"]);
    const may = overview[1];
    expect(may.counts).toEqual({ decision: 24, discussion: 3, document: 3, comment: 0 });
    expect(may.highlights.map(e => [e.kind, e.slug])).toEqual([["decision", "A"], ["decision", "B"], ["decision", "C"]]);

    const first = await getTimelineMonth(space.id, range, "2026-05");
    expect(first.items).toHaveLength(20);
    expect(first.nextCursor).toBeTruthy();
    const second = await getTimelineMonth(space.id, range, "2026-05", first.nextCursor!);
    expect(second.nextCursor).toBeNull();
    const all = [...first.items, ...second.items];
    expect(all).toHaveLength(may.total);
    expect(new Set(all.map(e => e.id)).size).toBe(may.total);
    expect(all.map(e => e.day)).toEqual(all.map(e => e.day).sort().reverse());
    const wrongMonth = await getTimelineMonth(space.id, range, "2026-06", first.nextCursor!);
    expect(wrongMonth.items.map(e => e.slug)).toEqual(["inside-end"]);
  } finally {
    await prisma.space.deleteMany({ where: { key: { in: [key, otherKey] } } });
  }
});
