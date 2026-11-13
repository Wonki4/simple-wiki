import { describe, expect, it } from "vitest";
import { snippetParts } from "../src/lib/search-snippet";

describe("검색 결과 본문", () => {
  it("위키 링크 안의 검색 강조를 보존한다", () => {
    expect(snippetParts("# 가이드 [[문서|[[HL]]온보딩[[/HL]]]] 참고")).toEqual([
      { value: "가이드 ", highlighted: false },
      { value: "온보딩", highlighted: true },
      { value: " 참고", highlighted: false },
    ]);
  });
  it("잘린 위키 링크와 표의 구분자를 제거한다", () => {
    expect(snippetParts("[[HL]]온보딩[[/HL]]]]으로 이동\n\n| 항목")).toEqual([
      { value: "", highlighted: false },
      { value: "온보딩", highlighted: true },
      { value: "으로 이동 항목", highlighted: false },
    ]);
  });
  it("본문의 # 기호와 링크 표시 이름을 남긴다", () => {
    expect(snippetParts("## C# 프로젝트\n[문서](https://example.com)와 **코드**")).toEqual([
      { value: "C# 프로젝트 문서와 코드", highlighted: false },
    ]);
  });
});
