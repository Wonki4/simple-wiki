import { test, expect, type Page } from "@playwright/test";
import { login } from "./helpers";

async function expireWikiSession(page: Page) {
  const sessionCookies = (await page.context().cookies()).filter((c) => c.name.includes("authjs.session-token"));
  expect(sessionCookies.length).toBeGreaterThan(0);
  await page.context().clearCookies({ name: /authjs\.session-token/ });
}

test("세션 만료 시 Keycloak SSO로 원래 페이지에 돌아오고, 로그아웃은 자동 로그인을 막는다", async ({ page }) => {
  await login(page, "bob", "bob1234");
  await expireWikiSession(page);

  await page.goto("/s/notice");
  await expect(page).toHaveURL(/\/s\/notice$/);
  await expect(page.getByRole("heading", { name: "공지사항" })).toBeVisible();

  await page.getByRole("button", { name: "로그아웃" }).click();
  await expect(page).toHaveURL("http://localhost:3000/");
  await page.goto("/s/notice");
  await expect(page).toHaveURL("http://localhost:3000/");
  await expect(page.getByRole("button", { name: "로그인" })).toBeVisible();

  await page.getByRole("button", { name: "로그인" }).click();
  await expect(page.getByRole("heading", { name: "공지사항" })).toBeVisible();
});

test("저장 시 세션이 만료되어도 재로그인 후 작성 중인 초안을 복원한다", async ({ page }) => {
  await login(page, "wiki-admin", "admin1234");
  await page.goto("/s/notice/new");
  await page.getByPlaceholder("제목").fill("재로그인 초안 테스트");
  await page.locator(".milkdown .ProseMirror").click();
  await page.keyboard.type("재로그인 뒤에도 남아 있어야 할 내용");
  await expireWikiSession(page);

  await page.getByRole("button", { name: "저장" }).click();
  await expect(page).toHaveURL(/\/s\/notice\/new$/);
  await expect(page.getByPlaceholder("제목")).toHaveValue("재로그인 초안 테스트");
  await expect(page.locator(".milkdown .ProseMirror")).toContainText("재로그인 뒤에도 남아 있어야 할 내용");
});
