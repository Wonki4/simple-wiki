import { expect, it } from "vitest";
import { resolveWikiNames } from "@/lib/wiki-link-destinations";

it("같은 이름이면 고정 주소, 현재 제목, 이전 제목 순서로 찾고 동순위의 모호한 이름은 제외한다", () => {
  const names = [
    { name: "고정", slug: "고정", priority: 0 },
    { name: "고정", slug: "다른", priority: 1 },
    { name: "최근", slug: "다른", priority: 1 },
    { name: "최근", slug: "고정", priority: 2 },
    { name: "공유", slug: "다른", priority: 2 },
    { name: "공유", slug: "고정", priority: 2 },
    { name: "옛 이름", slug: "고정", priority: 2 },
  ];
  const expected = new Map([["고정", "고정"], ["최근", "다른"], ["옛-이름", "고정"]]);
  expect(resolveWikiNames(names)).toEqual(expected);
  expect(resolveWikiNames(names.reverse())).toEqual(expected);
});
