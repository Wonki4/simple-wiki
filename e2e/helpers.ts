import type { Page } from "@playwright/test";

export async function login(page: Page, username: string, password: string) {
  await page.goto("/");
  await page.getByRole("button", { name: "로그인" }).click();
  await page.waitForURL(/localhost:8080/);
  await page.fill("#username", username);
  await page.fill("#password", password);
  await page.click("#kc-login");
  await page.waitForURL("http://localhost:3000/**");
}
