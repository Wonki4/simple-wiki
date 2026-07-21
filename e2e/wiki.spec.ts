import { test, expect } from "@playwright/test";
import { login } from "./helpers";

// 각 테스트는 독립 브라우저 컨텍스트(별도 세션)에서 실행된다.

test("그룹: 관리자가 alice를 추가하면 재로그인 없이 즉시 반영", async ({ page, browser }) => {
  // alice 첫 로그인 → User 행 생성. 아직 그룹 미소속이라 엔지니어링이 안 보인다.
  await login(page, "alice", "alice1234");
  await expect(page.getByRole("link", { name: "공지사항" })).toBeVisible();
  await expect(page.getByRole("link", { name: "엔지니어링" })).not.toBeVisible();

  // 별도 브라우저에서 전역 관리자가 engineering 그룹에 alice를 추가한다.
  const adminContext = await browser.newContext();
  const adminPage = await adminContext.newPage();
  await login(adminPage, "wiki-admin", "admin1234");
  await adminPage.goto("/groups");
  const engSection = adminPage.locator("section", { hasText: "engineering" });
  await engSection.locator('input[name="email"]').fill("alice@example.com");
  await engSection.getByRole("button", { name: "멤버 추가" }).click();
  await expect(engSection.getByText("alice@example.com")).toBeVisible();
  await adminContext.close();

  // alice는 재로그인 없이 새로고침만으로 즉시 접근된다.
  await page.goto("/");
  await expect(page.getByRole("link", { name: "엔지니어링" })).toBeVisible();
});

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

  // 그룹 대상은 이제 드롭다운 — 먼저 /groups에서 hr 그룹을 만든다.
  await page.goto("/groups");
  await page.locator('input[name="name"]').fill("hr");
  await page.getByRole("button", { name: "그룹 만들기" }).click();
  await expect(page.locator("section", { hasText: "hr" }).first()).toBeVisible();

  await page.goto("/s/e2e-docs/settings");
  const groupForm = page.locator('form:has(select[name="groupId"])');
  await groupForm.locator('select[name="groupId"]').selectOption({ label: "hr" });
  await groupForm.locator('select[name="role"]').selectOption("viewer");
  await groupForm.getByRole("button", { name: "그룹 권한 추가" }).click();
  await expect(page.getByRole("cell", { name: "hr" })).toBeVisible();

  // 없는 사용자는 크래시 대신 경고 배너 + 서버 로그
  const userForm = page.locator('form:has(input[name="email"])');
  await userForm.locator('input[name="email"]').fill("nobody@example.com");
  await userForm.getByRole("button", { name: "사용자 권한 추가" }).click();
  await expect(page.locator(".notice-warn").filter({ hasText: "사용자가 없습니다" })).toBeVisible();

  // Keycloak 아이디로 추가 — alice는 첫 테스트에서 로그인해 username이 채워져 있다
  await userForm.locator('input[name="email"]').fill("alice");
  await userForm.getByRole("button", { name: "사용자 권한 추가" }).click();
  await expect(page.getByRole("cell", { name: /alice@example.com/ })).toBeVisible();
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

test("API 이력/되돌리기: revisions 목록 + revert로 과거 내용 복원", async ({ page }) => {
  await login(page, "alice", "alice1234");
  const tag = `revert-${Date.now()}`;

  const result = await page.evaluate(async (tag) => {
    const create = await fetch("/api/spaces/eng/pages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: `되돌리기 ${tag}`, content: "원본 내용" }),
    });
    const slug = (await create.json()).slug as string;

    // v2로 수정
    await fetch(`/api/spaces/eng/pages/${slug}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: `되돌리기 ${tag}`, content: "바뀐 내용" }),
    });

    const histRes = await fetch(`/api/spaces/eng/pages/${slug}/revisions`);
    const hist = await histRes.json();

    // v1으로 revert
    const rev = await fetch(`/api/spaces/eng/pages/${slug}/revert`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ version: 1 }),
    });
    const revBody = await rev.json();

    const after = await (await fetch(`/api/spaces/eng/pages/${slug}`)).json();

    await fetch(`/api/spaces/eng/pages/${slug}`, { method: "DELETE" });
    return {
      histCount: hist.revisions.length,
      revStatus: rev.status,
      revVersion: revBody.version,
      afterContent: after.content,
    };
  }, tag);

  expect(result.histCount).toBe(2);
  expect(result.revStatus).toBe(200);
  expect(result.revVersion).toBe(3); // 전진형: v1 내용이 v3으로 기록
  expect(result.afterContent).toBe("원본 내용");
});

test("웹 복원: 리비전 상세에서 '이 버전으로 복원'", async ({ page }) => {
  await login(page, "alice", "alice1234");
  const tag = `webrestore-${Date.now()}`;
  const slug = await page.evaluate(async (tag) => {
    const c = await fetch("/api/spaces/eng/pages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: `웹복원 ${tag}`, content: "웹 원본" }),
    });
    const s = (await c.json()).slug as string;
    await fetch(`/api/spaces/eng/pages/${s}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: `웹복원 ${tag}`, content: "웹 수정본" }),
    });
    return s;
  }, tag);

  page.on("dialog", (d) => d.accept()); // ConfirmSubmitButton confirm 수락
  await page.goto(`/s/eng/${slug}/history/1`);
  await page.getByRole("button", { name: "이 버전으로 복원" }).click();
  await expect(page.getByText("웹 원본")).toBeVisible();

  await page.evaluate(async (s) => {
    await fetch(`/api/spaces/eng/pages/${s}`, { method: "DELETE" });
  }, slug);
});

test("웹 충돌 UX: 외부 수정 후 저장하면 충돌 배너, 재저장은 진행", async ({ page }) => {
  await login(page, "alice", "alice1234");
  const tag = `webconflict-${Date.now()}`;

  // 페이지 생성(v1)
  const slug = await page.evaluate(async (tag) => {
    const c = await fetch("/api/spaces/eng/pages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: `충돌 ${tag}`, content: "원본" }),
    });
    return (await c.json()).slug as string;
  }, tag);

  // 편집 화면 진입(에디터 expectedVersion=1)
  await page.goto(`/s/eng/${slug}/edit`);
  await page.locator(".milkdown .ProseMirror").click();
  await page.keyboard.type(" 내 수정");

  // 외부에서 먼저 저장 → v2
  await page.evaluate(async (slug) => {
    await fetch(`/api/spaces/eng/pages/${slug}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "외부", content: "외부 수정본" }),
    });
  }, slug);

  // 저장 → 충돌 배너
  // Next.js가 모든 페이지에 role="alert" 라우트 알림 요소를 자체 주입하므로
  // (accessible name은 없음) 텍스트 내용으로 배너를 특정한다.
  await page.getByRole("button", { name: "저장" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "먼저 수정" })).toContainText("먼저 수정");

  // 다시 저장 → 이제 expectedVersion=2라 통과, 페이지로 이동
  // 리다이렉트 URL은 encodeURIComponent(slug)로 만들어지므로 인코딩된 형태로 비교한다.
  await page.getByRole("button", { name: "저장" }).click();
  await expect(page).toHaveURL(new RegExp(`/s/eng/${encodeURIComponent(slug)}$`));

  await page.evaluate(async (slug) => {
    await fetch(`/api/spaces/eng/pages/${slug}`, { method: "DELETE" });
  }, slug);
});

test("파일 첨부: 버튼으로 올리고 본문 다운로드 링크로 확인", async ({ page }) => {
  await login(page, "alice", "alice1234");
  await page.goto("/s/eng/new");
  await page.locator('input[name="title"]').fill("파일 첨부 테스트");

  // 에디터(Crepe) 비동기 초기화가 끝나기 전의 change 이벤트는 무시된다(crepeRef 가드).
  // 다른 에디터 테스트처럼 본문 클릭으로 초기화 완료를 기다리고 커서도 본문에 둔다.
  await page.locator(".milkdown .ProseMirror").click();

  // 숨긴 파일 input은 form 직계 자식 — Crepe 내부의 이미지 input과 구분된다.
  await page.locator('form > input[type="file"]').setInputFiles({
    name: "spec.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("hello attachment"),
  });
  // 업로드 완료 → 에디터 본문에 링크 텍스트 삽입 확인
  await expect(page.locator(".wysiwyg").getByText("spec.txt")).toBeVisible();

  await page.getByRole("button", { name: "저장" }).click();
  await expect(page.getByRole("heading", { name: "파일 첨부 테스트" })).toBeVisible();

  // 읽기 화면의 링크가 attachment로 내려오는지 (인라인 아님 = 다운로드)
  const href = await page.getByRole("link", { name: "spec.txt" }).getAttribute("href");
  expect(href).toMatch(/^\/api\/attachments\//);
  const res = await page.request.get(href!);
  expect(res.status()).toBe(200);
  expect(res.headers()["content-disposition"] ?? "").toContain("attachment");
});

test("페이지 트리: 하위 문서 생성 → 사이드바 트리 → 삭제 승격 → 이동", async ({ page, browser }) => {
  await login(page, "alice", "alice1234");
  const move = () => page.locator("details.move");

  // 이동/삭제 서버액션은 revalidate 범위가 좁아 같은 세션에서 대상 페이지를 재방문하면
  // 라우터 캐시가 옛 렌더를 준다. 새 컨텍스트의 첫 방문으로 persist된 parent를 읽어 검증한다.
  async function parentValueFresh(slug: string): Promise<string> {
    const ctx = await browser.newContext();
    try {
      const p = await ctx.newPage();
      await login(p, "alice", "alice1234");
      await p.goto(`/s/eng/${slug}`);
      await expect(p.getByRole("heading").first()).toBeVisible();
      return (await p.locator("details.move").getAttribute("data-parent")) ?? "";
    } finally {
      await ctx.close();
    }
  }

  // 조부모 → 부모 → 자식 3레벨 트리를 "하위 문서" 버튼으로 만든다.
  await page.goto("/s/eng/new");
  await page.locator('input[name="title"]').fill("트리 조부모");
  await page.getByRole("button", { name: "저장" }).click();
  await expect(page.getByRole("heading", { name: "트리 조부모" })).toBeVisible();

  await page.getByRole("link", { name: "하위 문서" }).click();
  await expect(page.getByText("'트리 조부모' 하위에 만듭니다.")).toBeVisible();
  await page.locator('input[name="title"]').fill("트리 부모");
  await page.getByRole("button", { name: "저장" }).click();
  await expect(page.getByRole("heading", { name: "트리 부모" })).toBeVisible();

  await page.getByRole("link", { name: "하위 문서" }).click();
  await expect(page.getByText("'트리 부모' 하위에 만듭니다.")).toBeVisible();
  await page.locator('input[name="title"]').fill("트리 자식");
  await page.getByRole("button", { name: "저장" }).click();
  await expect(page.getByRole("heading", { name: "트리 자식" })).toBeVisible();

  // 사이드바: 자식이 트리 안에 들여쓰기로 보이고 접기 토글이 존재한다.
  const sidebar = page.locator(".lnb__docs");
  await expect(sidebar.getByRole("button", { name: "접기" }).first()).toBeVisible();
  await expect(sidebar.getByRole("link", { name: "트리 자식" })).toBeVisible();

  // 방금 만든 자식 페이지(새 렌더)에서 현재 부모가 "트리 부모"로 보인다.
  await expect(move()).toHaveAttribute("data-parent", "트리-부모");

  // 삭제 승격: 자식이 달린 "트리 부모"(부모=트리 조부모)를 삭제하면 자식은 사라지지 않고
  // 최상위(FK SET NULL)가 아니라 삭제된 노드의 부모인 "트리 조부모"로 승격된다.
  await page.goto("/s/eng/트리-부모");
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "삭제" }).click();
  await expect(page).toHaveURL(/\/s\/eng$/);
  expect(await parentValueFresh("트리-자식")).toBe("트리-조부모");

  // 이동: 승격된 자식을 최상위로 옮긴다(웹 이동 액션). 새 컨텍스트로 persist 확인.
  await page.goto("/s/eng/트리-자식");
  await move().locator("summary").click();
  await move().locator('button[name="parent"][value=""]').click();
  // 이동 서버액션은 자식 페이지로 redirect한다(완료 대기). 검증은 새 컨텍스트로.
  await page.waitForURL((u) => u.pathname.includes(encodeURIComponent("트리-자식")));
  expect(await parentValueFresh("트리-자식")).toBe("");
});

test("API 토큰으로 첨부 업로드/다운로드", async ({ page, request }) => {
  await login(page, "alice", "alice1234");

  // 토큰 발급 — 원문은 발급 직후 한 번만 노출된다(data-testid="new-token")
  await page.goto("/settings/tokens");
  await page.locator('input[name="name"]').fill("e2e-attach");
  await page.getByRole("button", { name: "토큰 발급" }).click();
  const raw = (await page.getByTestId("new-token").textContent())!.trim();
  expect(raw).toMatch(/^swk_/);

  try {
    // request 픽스처는 브라우저 쿠키와 무관 → 순수 토큰 인증 경로 검증
    const body = Buffer.from("mcp attachment e2e " + Date.now());
    const up = await request.post("/api/spaces/eng/attachments", {
      headers: { Authorization: `Bearer ${raw}` },
      multipart: { file: { name: "e2e-attach.txt", mimeType: "text/plain", buffer: body } },
    });
    expect(up.status()).toBe(200);
    const meta = await up.json();
    expect(meta.url).toMatch(/^\/api\/attachments\//);
    expect(meta.filename).toBe("e2e-attach.txt");

    const down = await request.get(meta.url, { headers: { Authorization: `Bearer ${raw}` } });
    expect(down.status()).toBe(200);
    expect(await down.body()).toEqual(body);

    // 무인증(쿠키도 토큰도 없음)이면 401
    const anon = await request.post("/api/spaces/eng/attachments", {
      multipart: { file: { name: "x.txt", mimeType: "text/plain", buffer: Buffer.from("x") } },
    });
    expect(anon.status()).toBe(401);
  } finally {
    // 토큰 정리(행 누적 방지)
    await page.goto("/settings/tokens");
    page.once("dialog", (d) => d.accept());
    await page
      .locator("tr", { hasText: "e2e-attach" })
      .first()
      .getByRole("button", { name: "삭제" })
      .click();
    await expect(page.locator("tr", { hasText: "e2e-attach" })).toHaveCount(0);
  }
});
