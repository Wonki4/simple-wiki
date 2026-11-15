import { PrismaClient } from "@prisma/client";
import { expect, test, type Page } from "@playwright/test";
import { login } from "./helpers";

async function createPage(page: Page, spaceKey: string, title: string, content: string) {
  const res = await page.request.post(`/api/spaces/${spaceKey}/pages`, { data: { title, content } });
  expect(res.status()).toBe(201);
}

test("다른 활성 문서의 링크와 열람 권한으로 고아 문서를 판별한다", async ({ page, browser }) => {
  test.slow();
  const db = new PrismaClient();
  const id = Date.now();
  const [space, restricted] = await db.$transaction([
    db.space.create({ data: { key: `orphans-${id}`, name: "문서 연결 검사" } }),
    db.space.create({ data: { key: `private-${id}`, name: "비공개 원본", visibility: "restricted" } }),
  ]);
  const home = `/s/${space.key}`;
  const report = `${home}/-/orphan-pages`;
  const api = `/api/spaces/${space.key}/pages`;
  const list = page.locator("main .recent-list a");
  try {
    await login(page, "wiki-admin", "admin1234");
    await page.goto(home);
    await page.getByRole("link", { name: "고아 문서", exact: true }).click();
    await expect(page.getByText("고아 문서가 없습니다.")).toBeVisible();

    await createPage(page, space.key, "guide", "## 설치\n\n[[guide#설치]] [[#설치]]");
    await createPage(page, space.key, "index", "`[[guide]]`");
    await page.reload();
    await expect(list).toHaveCount(2);
    await list.filter({ hasText: "guide" }).click();
    await page.waitForURL(url => url.pathname === `${home}/guide`);
    await expect(page.getByRole("heading", { name: "guide", exact: true })).toBeVisible();

    const updateIndex = (content: string) => page.request.put(`${api}/index`, { data: { title: "index", content } });
    expect((await updateIndex("[[guide#설치|설치 방법]]")).ok()).toBe(true);
    await page.goto(report);
    await expect(list).toHaveCount(1);
    await expect(list).toHaveAttribute("href", `${home}/index`);
    expect((await updateIndex("링크를 제거했습니다.")).ok()).toBe(true);
    await page.reload();
    await expect(list).toHaveCount(2);

    // 다른 스페이스의 원본과 대상이 같은 slug여도 서로 다른 문서다.
    await createPage(page, restricted.key, "guide", `[[${space.key}:guide]]\n\n[목록](${home}/index)`);
    await page.reload();
    await expect(page.getByText("고아 문서가 없습니다.")).toBeVisible();
    const reader = await browser.newContext({ viewport: { width: 360, height: 800 } });
    try {
      const view = await reader.newPage();
      await login(view, "bob", "bob1234");
      await view.goto(home);
      await view.getByRole("link", { name: "고아 문서", exact: true }).click();
      await expect(view.locator("main .recent-list a")).toHaveCount(2);
      expect(await view.evaluate(() => document.documentElement.scrollWidth)).toBe(360);
      const response = await view.goto(`/s/${restricted.key}/-/orphan-pages`);
      await expect(view.getByRole("heading", { name: "고아 문서", exact: true })).toHaveCount(0);
      expect(response?.status()).toBe(404);
    } finally {
      await reader.close();
    }

    const trash = await page.request.delete(`/api/spaces/${restricted.key}/pages/guide`);
    expect(trash.ok()).toBe(true);
    await page.reload();
    await expect(list).toHaveCount(2);
    expect((await page.request.delete(`${api}/index`)).ok()).toBe(true);
    await page.reload();
    await expect(list).toHaveCount(1);
    await expect(list).toHaveAttribute("href", `${home}/guide`);
    const { trashId } = await trash.json();
    expect((await page.request.post(`/api/spaces/${restricted.key}/trash/${trashId}/restore`)).ok()).toBe(true);
    await page.reload();
    await expect(page.getByText("고아 문서가 없습니다.")).toBeVisible();
  } finally {
    await db.space.deleteMany({ where: { id: { in: [space.id, restricted.id] } } });
    await db.$disconnect();
  }
});
