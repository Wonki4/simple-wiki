import { describe, it, expect } from "vitest";
import { parseSearchPage, searchCacheKeyParts, searchSpaceIds } from "@/lib/search";

describe("searchCacheKeyParts (권한 격리)", () => {
  it("spaceIds를 정렬해 순서 무관하게 같은 키를 만든다", () => {
    const a = searchCacheKeyParts("hello", ["s2", "s1"]);
    const b = searchCacheKeyParts("hello", ["s1", "s2"]);
    expect(a).toEqual(b);
  });

  it("spaceIds 집합이 다르면 키가 다르다", () => {
    const a = searchCacheKeyParts("hello", ["s1", "s2"]);
    const b = searchCacheKeyParts("hello", ["s1"]);
    expect(a).not.toEqual(b);
  });

  it("query가 다르면 키가 다르다", () => {
    const a = searchCacheKeyParts("hello", ["s1"]);
    const b = searchCacheKeyParts("world", ["s1"]);
    expect(a).not.toEqual(b);
  });

  it("키에 query와 spaceIds가 모두 반영된다", () => {
    const parts = searchCacheKeyParts("hi", ["s1", "s2"]);
    expect(parts.join("|")).toContain("hi");
    expect(parts.join("|")).toContain("s1");
    expect(parts.join("|")).toContain("s2");
  });

  it("콤마 앨리어싱 충돌을 만들지 않는다(권한 격리)", () => {
    // (spaces=[s1,s2], q="foo") 와 (spaces=[s1], q="s2,foo") 가 같은 키가 되면 안 된다
    const a = searchCacheKeyParts("foo", ["s1", "s2"]);
    const b = searchCacheKeyParts("s2,foo", ["s1"]);
    expect(a.join(",")).not.toEqual(b.join(","));
  });
});

it("캐시는 페이지 번호와 페이지 크기를 구분한다", () => {
  const first = searchCacheKeyParts("위키", ["s"], 1, 20);
  expect(first).not.toEqual(searchCacheKeyParts("위키", ["s"], 2, 20));
  expect(first).not.toEqual(searchCacheKeyParts("위키", ["s"], 1, 50));
});

it("명시한 범위가 없거나 권한이 없으면 전체 검색으로 풀지 않는다", () => {
  const spaces = [{ id: "1", key: "notice" }, { id: "2", key: "eng" }];
  expect(searchSpaceIds(spaces)).toEqual(["1", "2"]);
  expect(searchSpaceIds(spaces, "eng")).toEqual(["2"]);
  expect(searchSpaceIds(spaces, "hidden")).toBeNull();
});

it("페이지가 생략되면 1, 잘못된 양식이나 지원 범위를 벗어난 숫자는 오류로 처리한다", () => {
  expect(parseSearchPage(null)).toBe(1);
  expect(parseSearchPage("12")).toBe(12);
  for (const value of ["", "-1", "0", "1.5", "1e2", "1a", "9007199254740992"]) {
    expect(parseSearchPage(value)).toBeNull();
  }
});
