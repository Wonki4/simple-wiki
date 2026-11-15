import { PrismaClient } from "@prisma/client";
import { expect, test, type Page } from "@playwright/test";
import { login } from "./helpers";

async function createPage(page: Page, space: string, title: string, content: string) {
  const res = await page.request.post(`/api/spaces/${space}/pages`, { data: { title, content } });
  expect(res.status()).toBe(201);
  return (await res.json()).slug as string;
}

test("원본 문서별 누락 문서·소제목을 검사하고 복구 사항과 열람 권한을 반영한다", async ({ page, browser }) => {
  test.slow(); // 두 계정으로 로그인하고 새 문서 편집기와 읽기 화면까지 연다.
  const db = new PrismaClient();
  const id = Date.now();
  const [space, restricted] = await db.$transaction([
    db.space.create({ data: { key: `links-${id}`, name: "링크 검사" } }),
    db.space.create({ data: { key: `private-${id}`, name: "제한된 링크 검사", visibility: "restricted" } }),
  ]);
  const home = `/s/${space.key}`;
  const report = `${home}/-/broken-links`;
  try {
    await login(page, "wiki-admin", "admin1234");
    const guide = await createPage(page, restricted.key, "guide", "## 설치\n\n## 설치");
    const release = await createPage(page, space.key, "release", "## 준비");
    const source = await createPage(page, space.key, "handbook", [
      "[[연락망]] [[연락망|별칭]] [[#체크리스트]] [[release#이전 절]]",
      `[[${restricted.key}:missing]] [[${restricted.key}:${guide}#없는 절]] [[${restricted.key}:${guide}#설치-2]]`,
      "`[[코드]]` [[release#준비]]",
    ].join("\n\n"));
    await page.goto(home);
    await page.getByRole("link", { name: "깨진 위키링크" }).click();
    const group = page.getByRole("region", { name: source });
    await expect(group.getByRole("listitem")).toHaveCount(5);
    await expect(group.getByRole("link", { name: "원본 문서 편집" })).toHaveAttribute("href", `${home}/${source}/edit`);
    const issue = (target: string) => group.getByRole("listitem").filter({ hasText: `[[${target}]]` });
    await expect(issue(`${restricted.key}:missing`).getByRole("link")).toHaveAttribute("href", `/s/${restricted.key}/new?title=missing`);
    await expect(issue(`${restricted.key}:guide#없는 절`).getByRole("link")).toHaveAttribute("href", `/s/${restricted.key}/guide`);
    await expect(issue("#체크리스트").getByRole("link")).toHaveAttribute("href", `${home}/${source}`);

    const context = await browser.newContext({ viewport: { width: 360, height: 800 } });
    try {
      const viewer = await context.newPage();
      await login(viewer, "bob", "bob1234");
      await viewer.goto(report);
      const visible = viewer.getByRole("region", { name: source });
      await expect(visible.getByRole("listitem")).toHaveCount(3);
      await expect(viewer.locator("main")).not.toContainText(restricted.key);
      await expect(visible.getByRole("link", { name: /편집|만들기/ })).toHaveCount(0);
      expect(await viewer.evaluate(() => document.documentElement.scrollWidth)).toBe(360);
      await viewer.goto(`/s/${restricted.key}/-/broken-links`);
      await expect(viewer.getByRole("heading", { name: "깨진 위키링크" })).toHaveCount(0);
    } finally {
      await context.close();
    }

    await issue("연락망").getByRole("link", { name: "대상 문서 만들기" }).click();
    await expect(page.getByRole("textbox", { name: "제목", exact: true })).toHaveValue("연락망");
    await page.getByRole("button", { name: "저장", exact: true }).click();
    await page.waitForURL(url => decodeURIComponent(url.pathname) === `${home}/연락망`);
    await expect(page.getByRole("heading", { name: "연락망", exact: true })).toBeVisible();
    await page.goto(report);
    await expect(issue("연락망")).toHaveCount(0);
    const api = `/api/spaces/${space.key}/pages`;
    expect((await page.request.put(`${api}/${release}`, {
      data: { title: "새 제목", content: "## 이전 절\n\n## 준비" },
    })).ok()).toBe(true);
    await page.reload();
    await expect(issue("release#이전 절")).toHaveCount(0);
    expect((await page.request.put(`${api}/${source}`, {
      data: { title: source, content: "[[release#이전 절]]" },
    })).ok()).toBe(true);
    await page.reload();
    await expect(page.getByText("깨진 위키링크가 없습니다.")).toBeVisible();
    const trashed = await page.request.delete(`${api}/${release}`);
    expect(trashed.ok()).toBe(true);
    await page.reload();
    await expect(issue("release#이전 절")).toContainText("대상 문서를 찾을 수 없음");
    const deleted = await page.request.delete(`${api}/${source}`);
    expect(deleted.ok()).toBe(true);
    await page.reload();
    await expect(page.getByText("깨진 위키링크가 없습니다.")).toBeVisible();
  } finally {
    await db.space.deleteMany({ where: { id: { in: [space.id, restricted.id] } } });
    await db.$disconnect();
  }
});
