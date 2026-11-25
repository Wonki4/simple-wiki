import { describe, expect, it } from "vitest";
import { readTimelineInput, timelineRows } from "@/lib/timeline-write-input";

const evidence = "배포 후 오류율 2%를 넘으면 롤백하기로 했다.";
const entry = { kind: "decision" as const, summary: "롤백 기준을 오류율 2%로 정했다.", evidence };
const revision = {
  id: "v2", pageId: "page", version: 2, title: "운영 회의록", content: evidence,
  createdAt: new Date("2026-05-31T15:01:00Z"),
};
function request(body: unknown) {
  return new Request("http://wiki.test/api", { method: "PUT", body: JSON.stringify(body) });
}

describe("문서 버전별 협의·결정 기록", () => {
  it("해당 버전에 기록할 항목이 없는 경우도 표현한다", async () => {
    await expect(readTimelineInput(request({ version: 1, entries: [] }))).resolves.toEqual({ version: 1, entries: [] });
    expect(timelineRows(revision, [])).toEqual([]);
  });
  it.each([
    { version: 0, entries: [] }, { version: 2147483648, entries: [] }, { version: 1, entries: null },
    { version: 1, entries: [{ ...entry, kind: "comment" }] }, { version: 1, entries: [{ ...entry, summary: "새\n결정" }] },
    { version: 1, entries: [{ ...entry, evidence: "   " }] }, { version: 1, entries: [{ ...entry, evidence: "\ud800" }] },
    { version: 1, entries: [{ ...entry, date: "2026-02-29" }] },
  ])("잘못된 버전·종류·요약·근거·날짜를 거절한다", async body => {
    await expect(readTimelineInput(request(body))).rejects.toMatchObject({ status: 400 });
  });
  it.each(["2026-05-08", "2026. 5. 8.", "2026/5/8", "2026년 5월 8일"])(
    "원문에 명시된 %s 회의를 기록일 대신 회의일로 분류한다", dateInDocument => {
      const [row] = timelineRows({ ...revision, title: `${dateInDocument} 운영 회의록` }, [{ ...entry, date: "2026-05-08" }]);
      expect(row).toMatchObject({ evidence, explicitDate: true, eventDay: new Date("2026-05-08T00:00:00Z") });
    },
  );
  it("근거의 부분 일치나 회의일의 숫자 접두사 일치로 저장하지 않는다", () => {
    expect(() => timelineRows(revision, [{ ...entry, evidence: evidence.replace("2%", "3%") }])).toThrow("원문과 일치");
    expect(() => timelineRows({ ...revision, title: "2026-05-18 운영 회의록" }, [{ ...entry, date: "2026-05-01" }]))
      .toThrow("날짜를");
  });
  it("인용은 보존하고 날짜가 없는 기록에 한국 날짜를 사용한다", () => {
    const [row] = timelineRows(revision, [entry]);
    expect(row).toMatchObject({ evidence, revisionId: "v2", explicitDate: false, eventDay: new Date("2026-06-01T00:00:00Z") });
  });
  it("유지된 결정은 원래 항목과 같은 식별값이고 새 논의나 번복은 별개의 항목이다", () => {
    const [original] = timelineRows(revision, [entry]);
    const later = { ...revision, id: "v3", version: 3, createdAt: new Date("2026-06-10T01:00:00Z") };
    const [unchanged] = timelineRows(later, [{ ...entry, summary: "롤백 기준 합의" }]);
    const reversal = "기존 오류율 기준을 보류하기로 했다.";
    const [changed] = timelineRows({ ...later, content: reversal }, [{ ...entry, evidence: reversal }]);
    expect(original.fingerprint).toBe(unchanged.fingerprint);
    expect(original.fingerprint).not.toBe(changed.fingerprint);
    expect(timelineRows(revision, [entry])[0].id).toBe(original.id);
    expect(() => timelineRows(revision, [entry, { ...entry, summary: "같은 결정" }])).toThrow("두 번");
  });
});
