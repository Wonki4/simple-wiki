import { PrismaClient } from "@prisma/client";
import { expect, test } from "@playwright/test";
import { login } from "./helpers";

test("제목 일치가 본문 점수보다 우선하고 웹과 API의 모든 페이지에서 같은 순서를 사용한다", async ({ page }) => {
  test.slow();
  const db = new PrismaClient();
  const id = Date.now();
  const query = `배포 Guide${id}`;
  const [space, restricted] = await db.$transaction([
    db.space.create({ data: { key: `ranking-${id}`, name: "검색 순위 검사" } }),
    db.space.create({ data: { key: `private-${id}`, name: "제한된 검색 순위 검사", visibility: "restricted" } }),
  ]);
  try {
    const fixture = { spaceId: space.id, createdById: "ranking-test", updatedById: "ranking-test" };
    const repeated = (query + " ").repeat(12);
    await db.page.createMany({ data: [
      ...Array.from({ length: 51 }, (_, i) => ({
        ...fixture, slug: `partial-${i}`, title: `${query} 점검 ${i}`, content: repeated,
      })),
      { ...fixture, slug: "body", title: "운영 기록", content: query },
      { ...fixture, slug: "different-case", title: query.toLowerCase(), content: repeated },
      { ...fixture, slug: "exact", title: query, content: "" },
      { ...fixture, slug: "trashed", title: query, content: repeated, deletedAt: new Date() },
      { ...fixture, spaceId: restricted.id, slug: "secret", title: query, content: repeated },
    ] });

    await login(page, "bob", "bob1234");
    const params = new URLSearchParams({ q: `  ${query}  ` });
    const fetchPage = async (n: number) => {
      const response = await page.request.get(`/api/search?${params}&page=${n}`);
      expect(response.ok()).toBe(true);
      return await response.json() as { total: number; results: { slug: string }[] };
    };
    const first = await fetchPage(1);
    const second = await fetchPage(2);
    const slugs = [...first.results, ...second.results].map(hit => hit.slug);
    expect(first.total).toBe(54);
    expect(first.results).toHaveLength(50);
    expect(second.results).toHaveLength(4);
    expect(slugs.slice(0, 2)).toEqual(["exact", "different-case"]);
    expect(slugs.at(-1)).toBe("body");
    expect(new Set(slugs).size).toBe(54);
    expect(slugs).not.toContain("secret");
    expect(slugs).not.toContain("trashed");

    params.set("space", space.key);
    await page.goto(`/search?${params}`);
    const titles = page.locator(".results-list .title-link");
    await expect(titles).toHaveCount(20);
    await expect(titles.nth(0)).toHaveText(query);
    await expect(titles.nth(1)).toHaveText(query.toLowerCase());
    await page.getByRole("link", { name: "다음", exact: true }).click();
    await expect(page.getByRole("navigation", { name: "검색 결과 페이지" })).toContainText("2 / 3");
    await expect(titles.first()).toHaveAttribute("href", `/s/${space.key}/${slugs[20]}`);
  } finally {
    await db.space.deleteMany({ where: { id: { in: [space.id, restricted.id] } } });
    await db.$disconnect();
  }
});

test("제목의 %, _, 역슬래시도 입력한 문자 그대로 비교한다", async ({ page }) => {
  const db = new PrismaClient();
  const author = { createdById: "ranking-test", updatedById: "ranking-test" };
  const space = await db.space.create({ data: {
    key: `symbols-${Date.now()}`, name: "검색 기호 검사",
    pages: { create: [
      { ...author, slug: "wildcard", title: "Run 100점", content: "Run_100% ".repeat(12) },
      { ...author, slug: "literal-case", title: "run_100%" },
      { ...author, slug: "literal", title: "Run_100%" },
      { ...author, slug: "backslash", title: "\\" },
    ] },
  } });
  try {
    await login(page, "bob", "bob1234");
    for (const [query, expected] of [
      ["Run_100%", ["literal", "literal-case", "wildcard"]],
      ["\\", ["backslash"]],
    ] as const) {
      const response = await page.request.get("/api/search", { params: { q: query, space: space.key } });
      expect(response.ok()).toBe(true);
      const { results } = await response.json();
      expect(results.map((hit: { slug: string }) => hit.slug).slice(0, expected.length)).toEqual(expected);
    }
  } finally {
    await db.space.delete({ where: { id: space.id } });
    await db.$disconnect();
  }
});
