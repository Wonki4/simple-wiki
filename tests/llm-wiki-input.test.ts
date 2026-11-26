import { describe, expect, it } from "vitest";
import { readWikiInput, wikiListOptions } from "@/lib/llm-wiki-input";

const change = { key: "기준", kind: "current", text: " 오류율 2% 초과 시 롤백 ", evidence: "  2%를 넘으면 롤백한다." };
const patch = { key: "배포", title: " 배포 기준 ", expectedVersion: 0, changes: [change] };
const input = (topics: unknown, version = 1) => readWikiInput(new Request("http://wiki.test", {
  method: "PUT", body: JSON.stringify({ topics, version }),
}));

describe("LLM Wiki 원문 반영 요청", () => {
  it("요약과 키를 정리하고 근거 문장의 공백을 보존한다", async () => {
    const { topics: [topic] } = await input([{ ...patch, key: "배포".normalize("NFD") }]);
    expect(topic).toEqual({ ...patch, title: "배포 기준", changes: [{ ...change, text: change.text.trim() }] });
    await expect(input([])).resolves.toEqual({ version: 1, topics: [] });
  });

  it.each([
    [patch, { ...patch, key: "배포".normalize("NFD") }],
    [{ ...patch, changes: [change, change] }], [{ ...patch, changes: [] }],
    [{ ...patch, key: "../다른-문서" }], [{ ...patch, expectedVersion: -1 }],
    [{ ...patch, changes: [{ ...change, kind: "suggested" }] }],
    [{ ...patch, changes: [{ ...change, evidence: "   " }] }],
    [{ ...patch, changes: [{ ...change, text: "\0" }] }],
  ].map(topics => ({ topics })))("잘못되거나 중복된 변경을 거부한다", async ({ topics }) => {
    await expect(input(topics)).rejects.toMatchObject({ status: 400 });
  });

  it("버전 범위·전체 크기를 제한한다", async () => {
    await expect(input([], 0)).rejects.toMatchObject({ status: 400 });
    await expect(input([], 2147483648)).rejects.toMatchObject({ status: 400 });
    await expect(input([{ ...patch, title: "a".repeat(1024 * 1024) }])).rejects.toMatchObject({ status: 413 });
  });

  it("목록 페이지 크기와 검색어를 검증한다", () => {
    expect(wikiListOptions(new URLSearchParams("q=%20배포%20&limit=10&offset=10"))).toEqual({ q: "배포", limit: 10, offset: 10 });
    expect(() => wikiListOptions(new URLSearchParams("limit=101"))).toThrow();
    expect(() => wikiListOptions(new URLSearchParams("offset=-1"))).toThrow();
    expect(() => wikiListOptions(new URLSearchParams({ q: "A".repeat(161) }))).toThrow();
  });
});
