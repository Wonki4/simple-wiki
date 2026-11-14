import { expect, it } from "vitest";
import { completedLink, linkAtCaret, matchingPages } from "../src/lib/wiki-link-completion";
import { extractWikiLinks } from "../src/lib/wiki-links";

it("커서 앞의 열린 링크만 찾고 기존 닫는 괄호와 별칭을 보존한다", () => {
  expect(linkAtCaret("앞 [[가이드|안내]] 뒤", 5)).toEqual({ start: 2, end: 12, query: "가", label: "안내" });
  expect(linkAtCaret("앞 [[", 4)?.query).toBe("");
  for (const text of ["[[문서]]", "[[문서|설명", "[[문서\n본문", "\\[[예제"]) {
    expect(linkAtCaret(text, text.length)).toBeNull();
  }
});

it("부분 일치보다 제목 또는 주소의 앞부분이 일치하는 결과를 먼저 보여준다", () => {
  const pages = [{ title: "추가 가이드", slug: "extra" }, { title: "가이드", slug: "guide" }];
  expect(matchingPages(pages, "가이")[0]).toBe(pages[1]);
  expect(matchingPages(pages, "GUI")).toEqual([pages[1]]);
  expect(matchingPages(pages, "없음")).toEqual([]);
});

it("동명·이름 변경·마크다운 문법을 포함한 제목도 선택한 주소로 연결한다", () => {
  for (const page of [
    { title: "개발 안내", slug: "개발-안내" }, { title: "개발 안내", slug: "안내-v1" },
    { title: "[도구] A | B", slug: "도구-a-b" },
  ]) {
    expect(extractWikiLinks(completedLink(page))[0]?.slug).toBe(page.slug);
  }
  expect(completedLink({ title: "새 이름", slug: "예전-주소" })).toBe("[[예전-주소|새 이름]]");
  expect(completedLink({ title: "설치 (v2)", slug: "설치-v2" })).toBe("[[설치 (v2)]]");
});
