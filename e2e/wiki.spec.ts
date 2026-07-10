import { test, expect } from "@playwright/test";
import { login } from "./helpers";

// 각 테스트는 독립 브라우저 컨텍스트(별도 세션)에서 실행된다.

test("alice: 페이지 생성 → 위키링크 → 편집 → 이력 → 검색", async ({ page }) => {
  await login(page, "alice", "alice1234");

  // eng 스페이스 진입 및 페이지 생성
  await page.getByRole("link", { name: "엔지니어링" }).click();
  await page.getByRole("link", { name: "새 페이지" }).click();
  await page.getByPlaceholder("제목").fill("E2E 온보딩");
  await page.locator(".cm-content").click();
  await page.keyboard.type("# 환영\n\n[[없는 문서]] 참고");
  await page.getByRole("button", { name: "저장" }).click();
  await expect(page.getByRole("heading", { name: "E2E 온보딩" })).toBeVisible();
  await expect(page.locator("a.wiki-link-missing")).toBeVisible();

  // 편집 → 이력 2개
  await page.getByRole("link", { name: "편집" }).click();
  await page.locator(".cm-content").click();
  await page.keyboard.type("\n\n두 번째 버전");
  await page.getByRole("button", { name: "저장" }).click();
  await page.getByRole("link", { name: "이력" }).click();
  await expect(page.getByRole("link", { name: "v2" })).toBeVisible();
  await expect(page.getByRole("link", { name: "v1" })).toBeVisible();

  // 검색
  await page.getByPlaceholder("검색").fill("온보딩");
  await page.getByPlaceholder("검색").press("Enter");
  await expect(page.getByRole("link", { name: "E2E 온보딩" })).toBeVisible();
});

test("bob: restricted 스페이스는 보이지 않고 직접 접근도 404", async ({ page }) => {
  await login(page, "bob", "bob1234");
  await expect(page.getByRole("link", { name: "공지사항" })).toBeVisible();
  await expect(page.getByRole("link", { name: "엔지니어링" })).not.toBeVisible();

  await page.goto("/s/eng");
  await expect(page.getByText("페이지를 찾을 수 없습니다")).toBeVisible();

  // organization 스페이스는 읽기는 되지만 편집 진입은 차단
  await page.goto("/s/notice/new");
  await expect(page.getByRole("heading", { name: "권한이 없습니다" })).toBeVisible();
});

test("wiki-admin: 스페이스 생성과 권한 부여", async ({ page }) => {
  await login(page, "wiki-admin", "admin1234");
  await page.getByRole("link", { name: "새 스페이스" }).click();
  await page.locator('input[name="key"]').fill("e2e-docs");
  await page.locator('input[name="name"]').fill("E2E 문서");
  await page.locator('select[name="visibility"]').selectOption("restricted");
  await page.getByRole("button", { name: "만들기" }).click();
  await expect(page.getByRole("heading", { name: "E2E 문서" })).toBeVisible();

  await page.getByRole("link", { name: "설정" }).click();
  await page.locator('select[name="subjectType"]').selectOption("group");
  await page.locator('input[name="subjectValue"]').fill("/hr");
  await page.locator('select[name="role"]').selectOption("viewer");
  await page.getByRole("button", { name: "추가" }).click();
  await expect(page.getByRole("cell", { name: "/hr" })).toBeVisible();
});
