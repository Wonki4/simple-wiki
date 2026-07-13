import { test, expect } from "@playwright/test";
import { login } from "./helpers";

// 각 테스트는 독립 브라우저 컨텍스트(별도 세션)에서 실행된다.

test("alice: 페이지 생성 → 위키링크 → 편집 → 이력 → 검색", async ({ page }) => {
  await login(page, "alice", "alice1234");

  // eng 스페이스 진입 및 페이지 생성 (좌측 LNB에서)
  await page.getByRole("link", { name: "엔지니어링" }).first().click();
  await page.getByRole("link", { name: "새 문서" }).click();
  await page.getByPlaceholder("제목").fill("E2E 온보딩");
  await page.locator(".milkdown .ProseMirror").click();
  await page.keyboard.type("# 환영\n\n[[없는 문서]] 참고");
  await page.getByRole("button", { name: "저장" }).click();
  await expect(page.getByRole("heading", { name: "E2E 온보딩" })).toBeVisible();
  await expect(page.locator("a.wiki-link-missing")).toBeVisible();

  // 편집 → 이력 2개
  await page.getByRole("link", { name: "편집" }).click();
  await page.locator(".milkdown .ProseMirror").click();
  await page.keyboard.press("ControlOrMeta+End");
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

test("검색 권한 격리: 비권한자에겐 제한 스페이스 문서가 검색되지 않는다", async ({ page, browser }) => {
  const marker = "제트팩추진체";

  // alice(eng editor)가 제한 스페이스 eng에 고유어가 담긴 문서를 만든다
  await login(page, "alice", "alice1234");
  await page.getByRole("link", { name: "엔지니어링" }).first().click();
  await page.getByRole("link", { name: "새 문서" }).click();
  await page.getByPlaceholder("제목").fill("검색격리 테스트");
  await page.locator(".milkdown .ProseMirror").click();
  await page.keyboard.type(`# 검색격리\n\n${marker} 는 eng 전용 고유어`);
  await page.getByRole("button", { name: "저장" }).click();
  await expect(page.getByRole("heading", { name: "검색격리 테스트" })).toBeVisible();

  // alice는 검색으로 찾을 수 있다
  await page.goto(`/search?q=${encodeURIComponent(marker)}`);
  await expect(page.getByRole("link", { name: "검색격리 테스트" })).toBeVisible();

  // bob(eng 무권한, notice만 읽음)은 같은 검색어로 0건이어야 한다
  const bobContext = await browser.newContext();
  const bob = await bobContext.newPage();
  await login(bob, "bob", "bob1234");
  await bob.goto(`/search?q=${encodeURIComponent(marker)}`);
  await expect(bob.getByText("결과가 없습니다.")).toBeVisible();
  await expect(bob.getByRole("link", { name: "검색격리 테스트" })).toHaveCount(0);
  await bobContext.close();
});

test("API 낙관적 잠금: stale expectedVersion은 409", async ({ page }) => {
  await login(page, "alice", "alice1234");
  const slug = `lock-test-${Date.now()}`;

  const result = await page.evaluate(async (slug) => {
    const title = `잠금테스트 ${slug}`;
    // 생성
    const create = await fetch("/api/spaces/eng/pages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title, content: "처음" }),
    });
    const created = await create.json();
    const realSlug = created.slug as string;

    // 현재 버전 확인
    const g1 = await fetch(`/api/spaces/eng/pages/${realSlug}`);
    const p1 = await g1.json();

    // 올바른 expectedVersion으로 수정 → 200
    const ok = await fetch(`/api/spaces/eng/pages/${realSlug}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title, content: "두번째", expectedVersion: p1.version }),
    });

    // 같은(이제 stale) 버전으로 다시 수정 → 409
    const stale = await fetch(`/api/spaces/eng/pages/${realSlug}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title, content: "세번째", expectedVersion: p1.version }),
    });
    const staleBody = await stale.json();

    // 정리
    await fetch(`/api/spaces/eng/pages/${realSlug}`, { method: "DELETE" });

    return {
      firstVersion: p1.version,
      okStatus: ok.status,
      staleStatus: stale.status,
      currentVersion: staleBody.currentVersion,
    };
  }, slug);

  expect(result.firstVersion).toBe(1);
  expect(result.okStatus).toBe(200);
  expect(result.staleStatus).toBe(409);
  expect(result.currentVersion).toBe(2);
});

test("API 부분 편집: append와 replace(1곳/모호)", async ({ page }) => {
  await login(page, "alice", "alice1234");
  const tag = `edit-${Date.now()}`;

  const result = await page.evaluate(async (tag) => {
    const mk = async (title: string, content: string) => {
      const r = await fetch("/api/spaces/eng/pages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, content }),
      });
      return (await r.json()).slug as string;
    };
    const read = async (slug: string) => {
      const r = await fetch(`/api/spaces/eng/pages/${slug}`);
      return (await r.json()).content as string;
    };

    // append
    const a = await mk(`append ${tag}`, "첫 줄");
    await fetch(`/api/spaces/eng/pages/${a}/append`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: "둘째 줄" }),
    });
    const appended = await read(a);

    // replace 1곳
    const b = await mk(`replace ${tag}`, "alpha bravo charlie");
    const rep = await fetch(`/api/spaces/eng/pages/${b}/replace`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ old_string: "bravo", new_string: "BRAVO" }),
    });
    const replaced = await read(b);

    // replace 모호(2곳) → 422
    const c = await mk(`ambiguous ${tag}`, "dup and dup");
    const amb = await fetch(`/api/spaces/eng/pages/${c}/replace`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ old_string: "dup", new_string: "X" }),
    });

    // 정리
    for (const s of [a, b, c]) {
      await fetch(`/api/spaces/eng/pages/${s}`, { method: "DELETE" });
    }
    return { appended, repStatus: rep.status, replaced, ambStatus: amb.status };
  }, tag);

  expect(result.appended).toContain("첫 줄");
  expect(result.appended).toContain("둘째 줄");
  expect(result.repStatus).toBe(200);
  expect(result.replaced).toBe("alpha BRAVO charlie");
  expect(result.ambStatus).toBe(422);
});
