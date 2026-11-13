import { test, expect } from "@playwright/test";
import { login } from "./helpers";

test("모바일에서 문서 트리로 이동하고 긴 제목을 편집한다", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page, "wiki-admin", "admin1234");
  await page.getByRole("button", { name: "위키 탐색 열기" }).click();
  const nav = page.getByRole("complementary", { name: "위키 탐색" });
  await nav.getByRole("link", { name: "엔지니어링" }).click();
  await expect(page.getByRole("heading", { name: "엔지니어링" })).toBeVisible();
  await expect(nav).toBeHidden();
  await page.getByRole("button", { name: "위키 탐색 열기" }).click();
  await nav.getByRole("link", { name: "새 문서" }).click();

  const title = page.getByRole("textbox", { name: "제목" });
  await title.fill("모바일 화면에서 여러 줄로 표시되는 엔지니어링 문서 편집 가이드");
  await expect(page.locator(".ProseMirror").first()).toBeVisible();
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
    expect(await title.evaluate(el => el.clientHeight >= el.scrollHeight - 1)).toBe(true);
    await expect(page.getByRole("button", { name: "저장" })).toBeInViewport();
  }
  await page.getByRole("link", { name: "취소" }).click();
  await expect(page).toHaveURL(/\/s\/eng$/);
  await page.getByRole("button", { name: "계정 메뉴" }).click();
  await expect(page.getByRole("button", { name: "로그아웃" })).toBeVisible();
});
