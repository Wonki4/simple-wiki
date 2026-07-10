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

test("첨부파일: 권한/SVG 차단", async ({ page, browser }) => {
  await login(page, "alice", "alice1234");

  const uploaded = await page.evaluate(async () => {
    async function upload(bytes: number[], type: string, filename: string) {
      const blob = new Blob([new Uint8Array(bytes)], { type });
      const form = new FormData();
      form.set("file", blob, filename);
      const res = await fetch("/api/spaces/eng/attachments", { method: "POST", body: form });
      return (await res.json()) as { id: string; url: string; filename: string };
    }

    const png = await upload(
      [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
      "image/png",
      "p.png"
    );
    const svgContent = '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>';
    const svgBytes = Array.from(new TextEncoder().encode(svgContent));
    const svg = await upload(svgBytes, "image/svg+xml;charset=utf-8", "x.svg");
    return { png, svg };
  });

  const pngHeaders = await page.evaluate(async (url) => {
    const res = await fetch(url);
    return {
      disposition: res.headers.get("content-disposition"),
      csp: res.headers.get("content-security-policy"),
    };
  }, uploaded.png.url);
  expect(pngHeaders.disposition ?? "").toMatch(/^inline/);

  const svgHeaders = await page.evaluate(async (url) => {
    const res = await fetch(url);
    return {
      disposition: res.headers.get("content-disposition"),
      csp: res.headers.get("content-security-policy"),
    };
  }, uploaded.svg.url);
  expect(svgHeaders.disposition ?? "").toMatch(/^attachment/);
  expect(svgHeaders.csp).toBeTruthy();

  // 교차 스페이스 격리: bob은 eng 첨부파일에 접근할 수 없다(404)
  const bobContext = await browser.newContext();
  const bobPage = await bobContext.newPage();
  await login(bobPage, "bob", "bob1234");
  const bobStatus = await bobPage.evaluate(async (url) => {
    const res = await fetch(url);
    return res.status;
  }, uploaded.png.url);
  expect(bobStatus).toBe(404);
  await bobContext.close();
});
