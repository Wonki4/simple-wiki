import { expect, it } from "vitest";
import { diffMarkdown } from "@/lib/revision-diff";

it("공통 문맥 사이의 삭제와 추가를 구분한다", () => {
  expect(diffMarkdown("앞\n옛 줄\n뒤\n", "앞\n새 줄\n뒤\n")).toEqual([
    { kind: "context", lines: ["앞"] }, { kind: "remove", lines: ["옛 줄"] },
    { kind: "add", lines: ["새 줄"] }, { kind: "context", lines: ["뒤"] },
  ]);
});
it("동일한 본문, 마지막 개행 및 CRLF 변경을 구분한다", () => {
  expect(diffMarkdown("", "")).toEqual([]);
  expect(diffMarkdown("a", "a\n")).toEqual([
    { kind: "remove", lines: ["a ⏎ 없음"] }, { kind: "add", lines: ["a"] },
  ]);
  expect(diffMarkdown("a\r\n", "a\n")?.[0].lines).toEqual(["a ␍"]);
});
