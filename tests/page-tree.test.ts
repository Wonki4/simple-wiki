import { describe, it, expect } from "vitest";
import { buildTree, selfAndDescendantIds, flattenTree, type TreePageInput } from "@/lib/page-tree";

const pages: TreePageInput[] = [
  { id: "1", slug: "guide", title: "가이드", parentId: null },
  { id: "2", slug: "onboard", title: "온보딩", parentId: "1" },
  { id: "3", slug: "arch", title: "아키텍처", parentId: "1" },
  { id: "4", slug: "faq", title: "FAQ", parentId: null },
  { id: "5", slug: "deep", title: "심화", parentId: "2" },
];

describe("buildTree", () => {
  it("부모-자식 중첩과 형제 제목순 정렬", () => {
    const roots = buildTree(pages);
    expect(roots.map((r) => r.title)).toEqual(["FAQ", "가이드"]);
    const guide = roots[1];
    expect(guide.children.map((c) => c.title)).toEqual(["아키텍처", "온보딩"]);
    expect(guide.children[1].children.map((c) => c.title)).toEqual(["심화"]);
  });
  it("목록에 없는 부모를 가진 문서(고아)는 최상위로", () => {
    const roots = buildTree([{ id: "x", slug: "x", title: "X", parentId: "ghost" }]);
    expect(roots.map((r) => r.title)).toEqual(["X"]);
  });
});

describe("selfAndDescendantIds", () => {
  it("자기 자신 + 모든 자손", () => {
    expect(selfAndDescendantIds(pages, "1")).toEqual(new Set(["1", "2", "3", "5"]));
    expect(selfAndDescendantIds(pages, "4")).toEqual(new Set(["4"]));
  });
});

describe("flattenTree", () => {
  it("들여쓰기 depth와 트리 순서", () => {
    const flat = flattenTree(buildTree(pages));
    expect(flat.map((f) => `${f.depth}:${f.title}`)).toEqual([
      "0:FAQ",
      "0:가이드",
      "1:아키텍처",
      "1:온보딩",
      "2:심화",
    ]);
  });
});
