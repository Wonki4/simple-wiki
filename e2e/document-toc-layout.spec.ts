import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { login } from "./helpers";

const db = new PrismaClient();
test.afterAll(() => db.$disconnect());

test("긴 문서 목차가 화면의 여유 폭을 사용하고 중첩된 소제목으로 이동한다", async ({ page }) => {
  await login(page, "wiki-admin", "admin1234");
  const key = `toc-${randomUUID()}`;
  const space = await db.space.create({ data: { key, name: "목차 검증", visibility: "restricted" } });
  try {
    const title = "guide";
    const section = "서비스 장애가 발생했을 때 확인할 항목과 운영 담당자에게 연락하는 방법";
    const nested = "문서버전별접근권한변경이력을확인하는방법".repeat(3);
    const content = `## 운영 안내\n\n### ${section}\n\n##### ${nested}\n\n담당자에게 확인합니다.`;
    const pages = `/api/spaces/${key}/pages`;
    expect((await page.request.post(pages, { data: { title, content } })).status()).toBe(201);
    expect((await page.request.put(`${pages}/${title}`, {
      data: { title, content: `${content}\n\n연락망을 갱신했습니다.` },
    })).ok()).toBe(true);

    const path = `/s/${key}/${title}`;
    const toc = page.getByRole("navigation", { name: "문서 목차" });
    for (const route of [path, `${path}/history/1`]) {
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.goto(route);
      await expect(toc.getByRole("link", { name: section, exact: true })).toBeVisible();
      expect((await toc.boundingBox())!.width).toBeGreaterThanOrEqual(280);
      await expect(page.locator(".document-body")).toHaveCSS("width", "704px");

      for (const width of [390, 320]) {
        await page.setViewportSize({ width, height: 844 });
        await toc.locator("summary").click();
        const panel = toc.locator(".disclosure__panel");
        const panelBox = (await panel.boundingBox())!;
        const row = (await page.locator(".document-meta-row").boundingBox())!;
        expect(panelBox.x).toBeCloseTo(row.x, 0);
        expect(panelBox.width).toBeCloseTo(row.width, 0);
        expect(panelBox.x + panelBox.width).toBeLessThanOrEqual(width);
        expect(await panel.evaluate(el => el.scrollWidth - el.clientWidth)).toBe(0);
        await toc.getByRole("link", { name: nested, exact: true }).click();
        await expect(page.locator("article :target")).toContainText(nested);
        await expect(panel).toBeHidden();
      }
    }

    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(path);
    const handle = await page.getByRole("separator", { name: "사이드바 너비 조절" }).boundingBox();
    await page.mouse.move(handle!.x + handle!.width / 2, handle!.y + handle!.height / 2);
    await page.mouse.down();
    await page.mouse.move(480, handle!.y + handle!.height / 2);
    await page.mouse.up();
    await toc.locator("summary").click();
    const box = (await toc.locator(".disclosure__panel").boundingBox())!;
    const article = (await page.locator(".document-body").boundingBox())!;
    expect(box.width).toBeGreaterThan(304);
    expect(box.x).toBeGreaterThanOrEqual(article.x);
    expect(box.x + box.width).toBeLessThanOrEqual(article.x + article.width + 1);
  } finally {
    await db.space.delete({ where: { id: space.id } });
  }
});
