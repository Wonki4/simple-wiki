import { describe, it, expect } from "vitest";
import { searchCacheKeyParts } from "@/lib/search";

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
});
