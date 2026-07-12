# MCP 협업 3종 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** MCP를 통해 LLM이 사람과 나란히 위키를 편집할 때 안전하도록 낙관적 잠금·이력/되돌리기·부분 편집을 기존 simple-wiki 위에 얹는다.

**Architecture:** `PageRevision.version`(페이지별 단조 증가, 기존 `@@unique([pageId, version])`)을 동시성 토큰이자 이력 축으로 재사용한다. `Page`에 denormalized `version` 컬럼 하나만 추가하고, 순수 편집 로직(`page-edits.ts`)과 트랜잭션 커밋 프리미티브(`commitRevision`)를 분리해 lib→API→MCP→웹 순으로 조립한다. 스펙: `docs/superpowers/specs/2026-07-13-mcp-collab-design.md`.

**Tech Stack:** Next.js 15 App Router(route handlers, server actions), Prisma 6 + PostgreSQL 16, `@modelcontextprotocol/sdk`(stdio/http), vitest(순수 단위), Playwright(e2e).

## Global Constraints

- PostgreSQL는 호스트 포트 **5433**을 쓴다(litellm 컨테이너 충돌 회피). `litellm_*` 컨테이너는 건드리지 않는다.
- 새 마이그레이션을 만들 때마다 Prisma가 끼워 넣는 stray `ALTER TABLE "Page" ALTER COLUMN "searchVector" DROP DEFAULT;` 줄을 적용 전 반드시 제거한다.
- 작성자 이메일은 열람자에게 절대 노출하지 않는다. 이력/리비전 응답은 표시 이름만 반환한다(없으면 "알 수 없음").
- `expectedVersion`은 항상 선택(optional)이다. 주어졌고 현재 버전과 다르면 `PageConflictError(currentVersion)` → HTTP **409** `{ error, currentVersion }`.
- `replace_in_page`는 `old_string`이 **정확히 1곳** 매치될 때만 성공한다. 0곳/2곳↑는 `ReplaceError` → HTTP **422**.
- revert는 **전진형**: 과거 리비전 내용을 새 리비전으로 기록하며 이력을 절대 삭제하지 않는다.
- 부분 편집(append/replace)은 API·MCP에만 노출한다. 웹 UI에는 노출하지 않는다.
- MCP 서버 버전을 `1.1.0` → `1.2.0`으로 올린다.
- e2e는 Playwright가 `npm run dev`(:3000)를 재사용한다. DB 연동 검증은 로그인 세션 쿠키로 `page.evaluate(() => fetch("/api/..."))`를 호출해 상태코드/본문을 단언하고, 만든 데이터는 테스트 끝에 삭제한다(고정 이름 오염 방지).
- 커밋 트레일러: `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.

---

### Task 1: `Page.version` 스키마 + 마이그레이션 + 백필

**Files:**
- Modify: `prisma/schema.prisma` (model Page, 121번째 줄 `updatedViaLabel String?` 아래)
- Create: `prisma/migrations/<timestamp>_add_page_version/migration.sql`
- Create(임시): `prisma/check-version-backfill.ts`

**Interfaces:**
- Produces: `Page.version: number` (Prisma 클라이언트 필드). 이후 모든 태스크가 `page.version`을 읽고 `version` 컬럼을 갱신한다.

- [ ] **Step 1: 스키마에 컬럼 추가**

`prisma/schema.prisma`의 `model Page`에서 `updatedViaLabel String?` 줄 바로 아래에 추가:

```prisma
  // 낙관적 잠금·이력용 현재 버전. 항상 최신 PageRevision.version과 같다.
  version         Int                   @default(1)
```

- [ ] **Step 2: 마이그레이션 파일만 생성(적용 안 함)**

Run: `npx prisma migrate dev --create-only --name add_page_version`
Expected: `prisma/migrations/<ts>_add_page_version/migration.sql` 생성. 아직 DB에 적용되지 않음.

- [ ] **Step 3: 마이그레이션 SQL 편집(drift 줄 제거 + 백필 추가)**

생성된 `migration.sql`을 열어 (a) 만약 `ALTER TABLE "Page" ALTER COLUMN "searchVector" DROP DEFAULT;` 줄이 있으면 삭제하고, (b) 컬럼 추가 줄 아래에 백필 UPDATE를 추가해 최종적으로 아래 내용이 되도록 한다:

```sql
-- AddColumn
ALTER TABLE "Page" ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1;

-- Backfill: 각 페이지의 version을 최신 리비전 version으로 맞춘다.
UPDATE "Page" p
SET "version" = COALESCE(sub.maxv, 1)
FROM (
  SELECT "pageId", MAX("version") AS maxv
  FROM "PageRevision"
  GROUP BY "pageId"
) sub
WHERE sub."pageId" = p."id";
```

- [ ] **Step 4: 마이그레이션 적용 + 클라이언트 재생성**

Run: `npx prisma migrate dev`
Expected: `add_page_version` 적용 완료, `prisma generate` 자동 실행. 오류 없음.

- [ ] **Step 5: 백필 검증 스크립트 작성**

`prisma/check-version-backfill.ts`:

```ts
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const pages = await prisma.page.findMany({ select: { id: true, version: true } });
  let mismatches = 0;
  for (const pg of pages) {
    const agg = await prisma.pageRevision.aggregate({
      where: { pageId: pg.id },
      _max: { version: true },
    });
    const expected = agg._max.version ?? 1;
    if (expected !== pg.version) {
      mismatches++;
      console.error(`mismatch page=${pg.id} version=${pg.version} expected=${expected}`);
    }
  }
  console.log(`checked ${pages.length} pages, ${mismatches} mismatches`);
  if (mismatches > 0) process.exit(1);
}

main().finally(() => prisma.$disconnect());
```

- [ ] **Step 6: 검증 실행**

Run: `npx tsx prisma/check-version-backfill.ts`
Expected: `checked <N> pages, 0 mismatches` 출력, exit 0.

- [ ] **Step 7: 임시 스크립트 삭제 + 커밋**

```bash
rm prisma/check-version-backfill.ts
git add prisma/schema.prisma prisma/migrations
git commit -m "feat(db): Page.version 컬럼 추가 + 최신 리비전으로 백필

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: 순수 편집·버전 로직 (`page-edits.ts`) + 단위 테스트

**Files:**
- Create: `src/lib/page-edits.ts`
- Create: `tests/page-edits.test.ts`

**Interfaces:**
- Produces:
  - `class PageConflictError extends Error { currentVersion: number }`
  - `class ReplaceError extends Error {}`
  - `assertExpectedVersion(current: number, expected: number | undefined): void`
  - `appendContent(current: string, added: string): string`
  - `applyReplace(current: string, oldStr: string, newStr: string): string`
  - `isVersionConflict(e: unknown): boolean`

- [ ] **Step 1: 실패하는 테스트 작성**

`tests/page-edits.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  PageConflictError,
  ReplaceError,
  assertExpectedVersion,
  appendContent,
  applyReplace,
  isVersionConflict,
} from "@/lib/page-edits";

describe("assertExpectedVersion", () => {
  it("expected 미지정이면 통과", () => {
    expect(() => assertExpectedVersion(5, undefined)).not.toThrow();
  });
  it("일치하면 통과", () => {
    expect(() => assertExpectedVersion(5, 5)).not.toThrow();
  });
  it("불일치면 PageConflictError(현재 버전 포함)", () => {
    try {
      assertExpectedVersion(6, 5);
      throw new Error("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(PageConflictError);
      expect((e as PageConflictError).currentVersion).toBe(6);
    }
  });
});

describe("appendContent", () => {
  it("빈 본문에 추가하면 추가분만", () => {
    expect(appendContent("", "새 줄")).toBe("새 줄");
  });
  it("기존 본문과 빈 줄 하나로 구분", () => {
    expect(appendContent("기존", "추가")).toBe("기존\n\n추가");
  });
  it("기존 본문의 꼬리 공백/개행은 정규화", () => {
    expect(appendContent("기존\n\n\n", "추가\n")).toBe("기존\n\n추가");
  });
  it("추가분이 공백뿐이면 기존 본문 유지", () => {
    expect(appendContent("기존", "   \n")).toBe("기존");
  });
});

describe("applyReplace", () => {
  it("정확히 1곳 치환", () => {
    expect(applyReplace("a b c", "b", "X")).toBe("a X c");
  });
  it("0곳이면 ReplaceError", () => {
    expect(() => applyReplace("a b c", "z", "X")).toThrow(ReplaceError);
  });
  it("2곳 이상이면 ReplaceError(개수 안내)", () => {
    try {
      applyReplace("dup dup", "dup", "X");
      throw new Error("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(ReplaceError);
      expect((e as Error).message).toContain("2곳");
    }
  });
  it("old_string이 빈 문자열이면 ReplaceError", () => {
    expect(() => applyReplace("abc", "", "X")).toThrow(ReplaceError);
  });
});

describe("isVersionConflict", () => {
  it("Prisma P2002는 true", () => {
    expect(isVersionConflict({ code: "P2002" })).toBe(true);
  });
  it("다른 코드/에러는 false", () => {
    expect(isVersionConflict({ code: "P2001" })).toBe(false);
    expect(isVersionConflict(new Error("x"))).toBe(false);
    expect(isVersionConflict(null)).toBe(false);
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npm test -- page-edits`
Expected: FAIL — `Cannot find module '@/lib/page-edits'`.

- [ ] **Step 3: 구현 작성**

`src/lib/page-edits.ts`:

```ts
// 페이지 편집의 순수 로직(트랜잭션/DB 없음). pages.ts가 이 위에서 조합한다.

// 낙관적 잠금 충돌. currentVersion은 서버가 아는 현재 버전.
export class PageConflictError extends Error {
  currentVersion: number;
  constructor(currentVersion: number) {
    super("페이지가 그사이 변경되었습니다.");
    this.name = "PageConflictError";
    this.currentVersion = currentVersion;
  }
}

// replace 대상이 0곳이거나 2곳 이상, 또는 old_string이 빈 문자열일 때.
export class ReplaceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReplaceError";
  }
}

// expected가 주어졌고 current와 다르면 충돌. undefined면 검사 생략(last-write-wins).
export function assertExpectedVersion(current: number, expected: number | undefined): void {
  if (expected !== undefined && expected !== current) {
    throw new PageConflictError(current);
  }
}

// 본문 끝에 added를 덧붙인다. 기존 본문이 있으면 빈 줄 하나로 구분한다.
export function appendContent(current: string, added: string): string {
  const base = current.replace(/\s+$/, "");
  const tail = added.replace(/^\s+/, "").replace(/\s+$/, "");
  if (!base) return tail;
  if (!tail) return base;
  return `${base}\n\n${tail}`;
}

// old를 정확히 1곳에서 new로 치환한다. 0곳/2곳↑/빈 문자열이면 ReplaceError.
export function applyReplace(current: string, oldStr: string, newStr: string): string {
  if (oldStr === "") throw new ReplaceError("old_string이 비어 있습니다.");
  const parts = current.split(oldStr);
  const count = parts.length - 1;
  if (count === 0) throw new ReplaceError("old_string을 찾지 못했습니다.");
  if (count > 1) {
    throw new ReplaceError(`old_string이 ${count}곳에서 매치됩니다. 더 긴 고유 문맥을 포함하세요.`);
  }
  return parts.join(newStr);
}

// Prisma의 P2002(리비전 (pageId, version) 유니크 위반)인지 판별한다.
export function isVersionConflict(e: unknown): boolean {
  return (
    typeof e === "object" &&
    e !== null &&
    "code" in e &&
    (e as { code: unknown }).code === "P2002"
  );
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npm test -- page-edits`
Expected: PASS (14 tests).

- [ ] **Step 5: 커밋**

```bash
git add src/lib/page-edits.ts tests/page-edits.test.ts
git commit -m "feat(pages): 순수 편집·버전 로직 + 단위 테스트

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: 낙관적 잠금 (lib 커밋 프리미티브 + `updatePageInSpace` + API PUT/GET) + e2e

**Files:**
- Modify: `src/lib/pages.ts` (`nextVersion` 제거, `commitRevision` 추가, `updatePageInSpace` 개정)
- Modify: `src/app/api/spaces/[spaceKey]/pages/[slug]/route.ts` (GET에 version, PUT에 expectedVersion→409)
- Modify: `e2e/wiki.spec.ts` (API 낙관적 잠금 테스트 추가)

**Interfaces:**
- Consumes: `assertExpectedVersion`, `isVersionConflict`, `PageConflictError` (Task 2); `Page.version` (Task 1).
- Produces:
  - `commitRevision(input: { page: { id: string; version: number; spaceId: string }; title: string; content: string; authorId: string; source: EditSource; viaLabel: string | null }): Promise<number>` — 새 버전 번호 반환, 경합 시 `PageConflictError`.
  - `updatePageInSpace(input: WritePageInput & { slug: string; expectedVersion?: number }): Promise<boolean>` — 시그니처에 `expectedVersion?` 추가.

- [ ] **Step 1: `pages.ts` 상단 import에 page-edits 추가**

`src/lib/pages.ts` 4번째 줄 `import { extractWikiLinks } from "@/lib/wiki-links";` 아래에 추가:

```ts
import { assertExpectedVersion, isVersionConflict, PageConflictError } from "@/lib/page-edits";
```

- [ ] **Step 2: `nextVersion` 헬퍼를 `commitRevision`으로 교체**

`src/lib/pages.ts`의 `nextVersion` 함수(17-20번째 줄) 전체를 아래로 교체:

```ts
// 페이지 본문 교체를 한 트랜잭션으로 커밋한다: Page 갱신 + 새 리비전 + 링크 동기화.
// 경합(같은 다음 version을 동시에 쓰는 경우)은 (pageId, version) 유니크 위반으로 감지해
// PageConflictError로 번역한다. 반환값은 새로 만들어진 버전 번호.
async function commitRevision(input: {
  page: { id: string; version: number; spaceId: string };
  title: string;
  content: string;
  authorId: string;
  source: EditSource;
  viaLabel: string | null;
}): Promise<number> {
  const nextV = input.page.version + 1;
  try {
    await prisma.$transaction(async (tx) => {
      await tx.page.update({
        where: { id: input.page.id },
        data: {
          title: input.title,
          content: input.content,
          version: nextV,
          updatedById: input.authorId,
          updatedSource: input.source,
          updatedViaLabel: input.viaLabel,
        },
      });
      await tx.pageRevision.create({
        data: {
          pageId: input.page.id,
          version: nextV,
          title: input.title,
          content: input.content,
          authorId: input.authorId,
          source: input.source,
          viaLabel: input.viaLabel,
        },
      });
      await syncLinks(tx, input.page.id, input.page.spaceId, input.content);
    });
  } catch (e) {
    if (isVersionConflict(e)) {
      const fresh = await prisma.page.findUnique({
        where: { id: input.page.id },
        select: { version: true },
      });
      throw new PageConflictError(fresh?.version ?? nextV);
    }
    throw e;
  }
  return nextV;
}
```

- [ ] **Step 3: `updatePageInSpace`를 버전 인지·commitRevision 사용으로 개정**

`src/lib/pages.ts`의 `updatePageInSpace` 함수 전체(원본 81-121번째 줄)를 아래로 교체:

```ts
/**
 * 기존 페이지 수정. 제목이 바뀌어도 slug는 유지한다(링크 안정성).
 * 저장할 때마다 새 리비전 스냅샷을 남긴다. 페이지가 없으면 false.
 * expectedVersion이 주어지면 현재 버전과 다를 때 PageConflictError를 던진다.
 */
export async function updatePageInSpace(
  input: WritePageInput & { slug: string; expectedVersion?: number },
): Promise<boolean> {
  const title = input.title.trim();
  if (!title) throw new Error("제목을 입력하세요.");

  const page = await prisma.page.findUnique({
    where: { spaceId_slug: { spaceId: input.spaceId, slug: input.slug } },
  });
  if (!page) return false;

  assertExpectedVersion(page.version, input.expectedVersion);

  await commitRevision({
    page: { id: page.id, version: page.version, spaceId: input.spaceId },
    title,
    content: input.content,
    authorId: input.authorId,
    source: input.source ?? "web",
    viaLabel: input.viaLabel ?? null,
  });

  return true;
}
```

- [ ] **Step 4: `createPageInSpace`의 리비전 생성이 version 1을 명시하도록 확인**

`createPageInSpace`는 이미 `version: 1`로 초기 리비전을 만들고 `Page.version`은 기본값 1이라 코드 변경이 필요 없다. 확인만 한다(원본 68-70번째 줄 `version: 1` 유지).

- [ ] **Step 5: 빌드로 타입 검증**

Run: `npm run build`
Expected: 성공(타입 오류 없음). `nextVersion` 참조가 남아 있지 않아야 한다.

- [ ] **Step 6: GET 라우트에 version 추가**

`src/app/api/spaces/[spaceKey]/pages/[slug]/route.ts`의 GET에서 select와 응답에 version을 추가한다. `select` 줄을:

```ts
    select: { slug: true, title: true, content: true, version: true, updatedAt: true },
```

로 바꾸고, `return Response.json({...})`에 `version: page.version,`을 추가한다:

```ts
  return Response.json({
    space: { key: auth.space.key, name: auth.space.name },
    slug: page.slug,
    title: page.title,
    content: page.content,
    version: page.version,
    updatedAt: page.updatedAt,
  });
```

- [ ] **Step 7: PUT 라우트에 expectedVersion + 409 처리**

같은 파일의 PUT에서, import에 `PageConflictError`를 추가한다(상단):

```ts
import { updatePageInSpace } from "@/lib/pages";
import { PageConflictError } from "@/lib/page-edits";
```

body 파싱부(`const content = ...` 아래)에 추가:

```ts
  const expectedVersion =
    typeof body.expectedVersion === "number" ? body.expectedVersion : undefined;
```

body 타입도 확장: `let body: { title?: unknown; content?: unknown; expectedVersion?: unknown };`

`updatePageInSpace` 호출을 expectedVersion 포함 + 충돌 분기로 교체:

```ts
  let found: boolean;
  try {
    found = await updatePageInSpace({
      spaceId: auth.space.id,
      slug,
      title,
      content,
      authorId: auth.actor.userId,
      source: auth.actor.via === "token" ? "api" : "web",
      viaLabel: auth.actor.via === "token" ? auth.actor.tokenName : null,
      expectedVersion,
    });
  } catch (e) {
    if (e instanceof PageConflictError) {
      return Response.json(
        { error: "페이지가 그사이 변경되었습니다.", currentVersion: e.currentVersion },
        { status: 409 },
      );
    }
    return Response.json({ error: e instanceof Error ? e.message : "수정 실패" }, { status: 400 });
  }
  if (!found) return Response.json({ error: "페이지가 없습니다." }, { status: 404 });
```

PUT 성공 응답에 `version`을 추가한다. `updatePageInSpace`가 boolean만 반환하므로, 성공 후 최신 version을 다시 읽어 반환한다. 성공 응답 직전에:

```ts
  const saved = await prisma.page.findUnique({
    where: { spaceId_slug: { spaceId: auth.space.id, slug } },
    select: { version: true },
  });
  return Response.json({
    space: { key: auth.space.key },
    slug,
    title: title.trim(),
    version: saved?.version,
    url: `/s/${spaceKey}/${encodeURIComponent(slug)}`,
  });
```

(`prisma`는 이 파일에 이미 import 되어 있다.)

- [ ] **Step 8: 빌드 확인**

Run: `npm run build`
Expected: 성공.

- [ ] **Step 9: e2e — API 낙관적 잠금 테스트 추가**

`e2e/wiki.spec.ts` 끝에 추가:

```ts
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
```

- [ ] **Step 10: e2e 실행**

Run: `npm run e2e -- -g "API 낙관적 잠금"`
Expected: 1 passed. (dev 서버가 :3000에 떠 있어야 함; playwright가 `reuseExistingServer`로 재사용)

- [ ] **Step 11: 커밋**

```bash
git add src/lib/pages.ts src/app/api/spaces/'[spaceKey]'/pages/'[slug]'/route.ts e2e/wiki.spec.ts
git commit -m "feat(api): 페이지 쓰기 낙관적 잠금(expectedVersion→409) + GET version 노출

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: 부분 편집 (editPageContent + append/replace lib + API 라우트) + e2e

**Files:**
- Modify: `src/lib/pages.ts` (`editPageContent`, `appendToPage`, `replaceInPage` 추가)
- Create: `src/app/api/spaces/[spaceKey]/pages/[slug]/append/route.ts`
- Create: `src/app/api/spaces/[spaceKey]/pages/[slug]/replace/route.ts`
- Modify: `e2e/wiki.spec.ts` (append/replace 테스트 추가)

**Interfaces:**
- Consumes: `commitRevision`, `updatePageInSpace` (Task 3); `appendContent`, `applyReplace`, `assertExpectedVersion`, `ReplaceError`, `PageConflictError` (Task 2).
- Produces:
  - `editPageContent(input: EditActionInput, transform: (current: string) => string): Promise<{ found: boolean; version?: number }>`
  - `appendToPage(input: EditActionInput & { content: string }): Promise<{ found: boolean; version?: number }>`
  - `replaceInPage(input: EditActionInput & { oldString: string; newString: string }): Promise<{ found: boolean; version?: number }>`
  - `type EditActionInput = { spaceId: string; slug: string; authorId: string; source?: EditSource; viaLabel?: string | null; expectedVersion?: number }`

- [ ] **Step 1: `pages.ts` import 확장**

`src/lib/pages.ts`의 page-edits import(Task 3에서 추가한 줄)에 `appendContent, applyReplace`를 더한다:

```ts
import {
  appendContent,
  applyReplace,
  assertExpectedVersion,
  isVersionConflict,
  PageConflictError,
} from "@/lib/page-edits";
```

- [ ] **Step 2: `editPageContent` + 래퍼 추가**

`src/lib/pages.ts`의 `updatePageInSpace` 함수 아래에 추가:

```ts
export type EditActionInput = {
  spaceId: string;
  slug: string;
  authorId: string;
  source?: EditSource;
  viaLabel?: string | null;
  expectedVersion?: number;
};

/**
 * 현재 본문을 읽어 transform을 적용한 뒤 커밋한다(부분 편집의 공통 경로).
 * 제목은 유지한다. transform은 위반 시 throw할 수 있다(예: ReplaceError).
 * 페이지가 없으면 { found: false }.
 */
export async function editPageContent(
  input: EditActionInput,
  transform: (current: string) => string,
): Promise<{ found: boolean; version?: number }> {
  const page = await prisma.page.findUnique({
    where: { spaceId_slug: { spaceId: input.spaceId, slug: input.slug } },
  });
  if (!page) return { found: false };

  assertExpectedVersion(page.version, input.expectedVersion);
  const newContent = transform(page.content); // 위반 시 여기서 throw

  const version = await commitRevision({
    page: { id: page.id, version: page.version, spaceId: input.spaceId },
    title: page.title,
    content: newContent,
    authorId: input.authorId,
    source: input.source ?? "api",
    viaLabel: input.viaLabel ?? null,
  });
  return { found: true, version };
}

// 본문 끝에 content를 덧붙인다.
export function appendToPage(
  input: EditActionInput & { content: string },
): Promise<{ found: boolean; version?: number }> {
  return editPageContent(input, (current) => appendContent(current, input.content));
}

// oldString을 정확히 1곳에서 newString으로 치환한다(0곳/2곳↑는 ReplaceError).
export function replaceInPage(
  input: EditActionInput & { oldString: string; newString: string },
): Promise<{ found: boolean; version?: number }> {
  return editPageContent(input, (current) => applyReplace(current, input.oldString, input.newString));
}
```

- [ ] **Step 3: append 라우트 작성**

`src/app/api/spaces/[spaceKey]/pages/[slug]/append/route.ts`:

```ts
import { NextRequest } from "next/server";
import { requireApiSpaceRole } from "@/lib/api-auth";
import { appendToPage } from "@/lib/pages";
import { PageConflictError } from "@/lib/page-edits";

// POST /api/spaces/{spaceKey}/pages/{slug}/append — 본문 끝에 마크다운 추가 (editor 권한)
// body: { content: string, expectedVersion?: number }
export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ spaceKey: string; slug: string }> },
) {
  const { spaceKey, slug: rawSlug } = await ctx.params;
  const slug = decodeURIComponent(rawSlug);
  const auth = await requireApiSpaceRole(req, spaceKey, "editor");
  if (!auth.ok) return auth.response;

  let body: { content?: unknown; expectedVersion?: unknown };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "JSON 본문이 올바르지 않습니다." }, { status: 400 });
  }
  const content = typeof body.content === "string" ? body.content : "";
  if (!content.trim()) return Response.json({ error: "content가 비어 있습니다." }, { status: 400 });
  const expectedVersion =
    typeof body.expectedVersion === "number" ? body.expectedVersion : undefined;

  try {
    const result = await appendToPage({
      spaceId: auth.space.id,
      slug,
      authorId: auth.actor.userId,
      source: auth.actor.via === "token" ? "api" : "web",
      viaLabel: auth.actor.via === "token" ? auth.actor.tokenName : null,
      expectedVersion,
      content,
    });
    if (!result.found) return Response.json({ error: "페이지가 없습니다." }, { status: 404 });
    return Response.json({
      slug,
      version: result.version,
      url: `/s/${spaceKey}/${encodeURIComponent(slug)}`,
    });
  } catch (e) {
    if (e instanceof PageConflictError) {
      return Response.json(
        { error: "페이지가 그사이 변경되었습니다.", currentVersion: e.currentVersion },
        { status: 409 },
      );
    }
    return Response.json({ error: e instanceof Error ? e.message : "추가 실패" }, { status: 400 });
  }
}
```

- [ ] **Step 4: replace 라우트 작성**

`src/app/api/spaces/[spaceKey]/pages/[slug]/replace/route.ts`:

```ts
import { NextRequest } from "next/server";
import { requireApiSpaceRole } from "@/lib/api-auth";
import { replaceInPage } from "@/lib/pages";
import { PageConflictError, ReplaceError } from "@/lib/page-edits";

// POST /api/spaces/{spaceKey}/pages/{slug}/replace — old_string을 정확히 1곳 치환 (editor 권한)
// body: { old_string: string, new_string: string, expectedVersion?: number }
export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ spaceKey: string; slug: string }> },
) {
  const { spaceKey, slug: rawSlug } = await ctx.params;
  const slug = decodeURIComponent(rawSlug);
  const auth = await requireApiSpaceRole(req, spaceKey, "editor");
  if (!auth.ok) return auth.response;

  let body: { old_string?: unknown; new_string?: unknown; expectedVersion?: unknown };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "JSON 본문이 올바르지 않습니다." }, { status: 400 });
  }
  const oldString = typeof body.old_string === "string" ? body.old_string : "";
  const newString = typeof body.new_string === "string" ? body.new_string : "";
  if (!oldString) return Response.json({ error: "old_string이 필요합니다." }, { status: 400 });
  const expectedVersion =
    typeof body.expectedVersion === "number" ? body.expectedVersion : undefined;

  try {
    const result = await replaceInPage({
      spaceId: auth.space.id,
      slug,
      authorId: auth.actor.userId,
      source: auth.actor.via === "token" ? "api" : "web",
      viaLabel: auth.actor.via === "token" ? auth.actor.tokenName : null,
      expectedVersion,
      oldString,
      newString,
    });
    if (!result.found) return Response.json({ error: "페이지가 없습니다." }, { status: 404 });
    return Response.json({
      slug,
      version: result.version,
      url: `/s/${spaceKey}/${encodeURIComponent(slug)}`,
    });
  } catch (e) {
    if (e instanceof ReplaceError) {
      return Response.json({ error: e.message }, { status: 422 });
    }
    if (e instanceof PageConflictError) {
      return Response.json(
        { error: "페이지가 그사이 변경되었습니다.", currentVersion: e.currentVersion },
        { status: 409 },
      );
    }
    return Response.json({ error: e instanceof Error ? e.message : "치환 실패" }, { status: 400 });
  }
}
```

- [ ] **Step 5: 빌드 확인**

Run: `npm run build`
Expected: 성공.

- [ ] **Step 6: e2e — append/replace 테스트 추가**

`e2e/wiki.spec.ts` 끝에 추가:

```ts
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
```

- [ ] **Step 7: e2e 실행**

Run: `npm run e2e -- -g "API 부분 편집"`
Expected: 1 passed.

- [ ] **Step 8: 커밋**

```bash
git add src/lib/pages.ts src/app/api/spaces/'[spaceKey]'/pages/'[slug]'/append src/app/api/spaces/'[spaceKey]'/pages/'[slug]'/replace e2e/wiki.spec.ts
git commit -m "feat(api): 부분 편집 append_to_page/replace_in_page 엔드포인트

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: 이력 조회 + 되돌리기 (revisions API + get_page?version + revert lib/route + 웹 restore 리팩터) + e2e

**Files:**
- Modify: `src/lib/pages.ts` (`revertPage` 추가)
- Create: `src/app/api/spaces/[spaceKey]/pages/[slug]/revisions/route.ts`
- Create: `src/app/api/spaces/[spaceKey]/pages/[slug]/revert/route.ts`
- Modify: `src/app/api/spaces/[spaceKey]/pages/[slug]/route.ts` (GET에 `?version=N` 분기)
- Modify: `src/actions/pages.ts` (`restoreRevision`을 `revertPage`로 리팩터, 미사용 `saveRevision` 정리는 Task 7)
- Modify: `e2e/wiki.spec.ts` (revert 테스트 추가)

**Interfaces:**
- Consumes: `commitRevision`, `assertExpectedVersion` (Task 3).
- Produces:
  - `revertPage(input: { spaceId: string; slug: string; version: number; authorId: string; source?: EditSource; viaLabel?: string | null; expectedVersion?: number }): Promise<{ found: boolean; missingRevision?: boolean; version?: number }>`

- [ ] **Step 1: `revertPage` 추가**

`src/lib/pages.ts`의 `replaceInPage` 아래에 추가:

```ts
/**
 * 과거 리비전 vN의 title+content를 새 리비전으로 전진 복원한다(이력 삭제 없음).
 * 페이지 없음 → { found: false }. 해당 버전 없음 → { found: true, missingRevision: true }.
 * expectedVersion이 주어지면 현재 버전과 다를 때 PageConflictError.
 */
export async function revertPage(input: {
  spaceId: string;
  slug: string;
  version: number;
  authorId: string;
  source?: EditSource;
  viaLabel?: string | null;
  expectedVersion?: number;
}): Promise<{ found: boolean; missingRevision?: boolean; version?: number }> {
  const page = await prisma.page.findUnique({
    where: { spaceId_slug: { spaceId: input.spaceId, slug: input.slug } },
  });
  if (!page) return { found: false };

  const rev = await prisma.pageRevision.findUnique({
    where: { pageId_version: { pageId: page.id, version: input.version } },
  });
  if (!rev) return { found: true, missingRevision: true };

  assertExpectedVersion(page.version, input.expectedVersion);

  const version = await commitRevision({
    page: { id: page.id, version: page.version, spaceId: input.spaceId },
    title: rev.title,
    content: rev.content,
    authorId: input.authorId,
    source: input.source ?? "web",
    viaLabel: input.viaLabel ?? null,
  });
  return { found: true, version };
}
```

- [ ] **Step 2: revisions 목록 라우트 작성**

`src/app/api/spaces/[spaceKey]/pages/[slug]/revisions/route.ts`:

```ts
import { NextRequest } from "next/server";
import { requireApiSpaceRole } from "@/lib/api-auth";
import { prisma } from "@/lib/db";

// GET /api/spaces/{spaceKey}/pages/{slug}/revisions — 리비전 메타 목록(본문 제외, 최신순)
export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ spaceKey: string; slug: string }> },
) {
  const { spaceKey, slug: rawSlug } = await ctx.params;
  const slug = decodeURIComponent(rawSlug);
  const auth = await requireApiSpaceRole(req, spaceKey, "viewer");
  if (!auth.ok) return auth.response;

  const page = await prisma.page.findUnique({
    where: { spaceId_slug: { spaceId: auth.space.id, slug } },
    select: { id: true },
  });
  if (!page) return Response.json({ error: "페이지가 없습니다." }, { status: 404 });

  const revisions = await prisma.pageRevision.findMany({
    where: { pageId: page.id },
    orderBy: { version: "desc" },
    select: { version: true, title: true, source: true, viaLabel: true, createdAt: true, authorId: true },
  });
  // 이메일은 노출하지 않는다(PII). 표시 이름만.
  const authorIds = [...new Set(revisions.map((r) => r.authorId))];
  const users = await prisma.user.findMany({
    where: { id: { in: authorIds } },
    select: { id: true, name: true },
  });
  const nameById = new Map(users.map((u) => [u.id, u.name?.trim() || "알 수 없음"]));

  return Response.json({
    slug,
    revisions: revisions.map((r) => ({
      version: r.version,
      title: r.title,
      author: nameById.get(r.authorId) ?? "알 수 없음",
      source: r.source,
      viaLabel: r.viaLabel,
      createdAt: r.createdAt,
    })),
  });
}
```

- [ ] **Step 3: revert 라우트 작성**

`src/app/api/spaces/[spaceKey]/pages/[slug]/revert/route.ts`:

```ts
import { NextRequest } from "next/server";
import { requireApiSpaceRole } from "@/lib/api-auth";
import { revertPage } from "@/lib/pages";
import { PageConflictError } from "@/lib/page-edits";

// POST /api/spaces/{spaceKey}/pages/{slug}/revert — vN 내용을 새 리비전으로 복원 (editor 권한)
// body: { version: number, expectedVersion?: number }
export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ spaceKey: string; slug: string }> },
) {
  const { spaceKey, slug: rawSlug } = await ctx.params;
  const slug = decodeURIComponent(rawSlug);
  const auth = await requireApiSpaceRole(req, spaceKey, "editor");
  if (!auth.ok) return auth.response;

  let body: { version?: unknown; expectedVersion?: unknown };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "JSON 본문이 올바르지 않습니다." }, { status: 400 });
  }
  const version = typeof body.version === "number" ? body.version : NaN;
  if (!Number.isInteger(version) || version < 1) {
    return Response.json({ error: "version이 올바르지 않습니다." }, { status: 400 });
  }
  const expectedVersion =
    typeof body.expectedVersion === "number" ? body.expectedVersion : undefined;

  try {
    const result = await revertPage({
      spaceId: auth.space.id,
      slug,
      version,
      authorId: auth.actor.userId,
      source: auth.actor.via === "token" ? "api" : "web",
      viaLabel: auth.actor.via === "token" ? auth.actor.tokenName : null,
      expectedVersion,
    });
    if (!result.found) return Response.json({ error: "페이지가 없습니다." }, { status: 404 });
    if (result.missingRevision) return Response.json({ error: "해당 버전이 없습니다." }, { status: 404 });
    return Response.json({
      slug,
      version: result.version,
      url: `/s/${spaceKey}/${encodeURIComponent(slug)}`,
    });
  } catch (e) {
    if (e instanceof PageConflictError) {
      return Response.json(
        { error: "페이지가 그사이 변경되었습니다.", currentVersion: e.currentVersion },
        { status: 409 },
      );
    }
    return Response.json({ error: e instanceof Error ? e.message : "복원 실패" }, { status: 400 });
  }
}
```

- [ ] **Step 4: GET에 `?version=N` 분기 추가**

`src/app/api/spaces/[spaceKey]/pages/[slug]/route.ts`의 GET을 아래로 교체(현재 페이지 fetch 후, version 파라미터가 있으면 해당 리비전을 반환):

```ts
export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ spaceKey: string; slug: string }> },
) {
  const { spaceKey, slug: rawSlug } = await ctx.params;
  const slug = decodeURIComponent(rawSlug);
  const auth = await requireApiSpaceRole(req, spaceKey, "viewer");
  if (!auth.ok) return auth.response;

  const page = await prisma.page.findUnique({
    where: { spaceId_slug: { spaceId: auth.space.id, slug } },
    select: { id: true, slug: true, title: true, content: true, version: true, updatedAt: true },
  });
  if (!page) return Response.json({ error: "페이지가 없습니다." }, { status: 404 });

  // ?version=N — 특정 리비전 원문
  const versionParam = req.nextUrl.searchParams.get("version");
  if (versionParam !== null) {
    const version = Number(versionParam);
    if (!Number.isInteger(version) || version < 1) {
      return Response.json({ error: "version이 올바르지 않습니다." }, { status: 400 });
    }
    const rev = await prisma.pageRevision.findUnique({
      where: { pageId_version: { pageId: page.id, version } },
      select: { version: true, title: true, content: true, source: true, viaLabel: true, createdAt: true },
    });
    if (!rev) return Response.json({ error: "해당 버전이 없습니다." }, { status: 404 });
    return Response.json({
      space: { key: auth.space.key, name: auth.space.name },
      slug: page.slug,
      title: rev.title,
      content: rev.content,
      version: rev.version,
      source: rev.source,
      viaLabel: rev.viaLabel,
      createdAt: rev.createdAt,
    });
  }

  return Response.json({
    space: { key: auth.space.key, name: auth.space.name },
    slug: page.slug,
    title: page.title,
    content: page.content,
    version: page.version,
    updatedAt: page.updatedAt,
  });
}
```

- [ ] **Step 5: 웹 `restoreRevision`을 `revertPage`로 리팩터**

`src/actions/pages.ts`의 import에 `revertPage`를 추가하고(`createPageInSpace, updatePageInSpace` 옆), `restoreRevision` 함수 본문(원본 56-68번째 줄)을 아래로 교체:

```ts
export async function restoreRevision(spaceKey: string, slug: string, version: number) {
  const { session, space } = await requireSpaceRole(spaceKey, "editor");
  const result = await revertPage({
    spaceId: space.id,
    slug,
    version,
    authorId: session.userId,
  });
  if (!result.found) throw new Error("페이지가 없습니다.");
  if (result.missingRevision) throw new Error("해당 버전이 없습니다.");

  revalidatePath(`/s/${spaceKey}`);
  revalidatePath(`/s/${spaceKey}/${encodeURIComponent(slug)}`);
  redirect(`/s/${spaceKey}/${encodeURIComponent(slug)}`);
}
```

import 줄:

```ts
import { createPageInSpace, updatePageInSpace, revertPage } from "@/lib/pages";
```

(`saveRevision`은 아직 `updatePage`가 쓰므로 이 태스크에서는 남겨 둔다. Task 7에서 제거.)

- [ ] **Step 6: 빌드 확인**

Run: `npm run build`
Expected: 성공.

- [ ] **Step 7: e2e — 이력/되돌리기(API) + 웹 복원(UI)**

`e2e/wiki.spec.ts` 끝에 추가:

```ts
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
```

- [ ] **Step 8: e2e 실행**

Run: `npm run e2e -- -g "이력/되돌리기|웹 복원"`
Expected: 2 passed.

- [ ] **Step 9: 커밋**

```bash
git add src/lib/pages.ts src/actions/pages.ts src/app/api/spaces/'[spaceKey]'/pages/'[slug]' e2e/wiki.spec.ts
git commit -m "feat(api): 리비전 목록·특정버전 조회·전진형 revert + 웹 복원 공유 lib화

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 6: MCP 도구 6종 + 지침 갱신

**Files:**
- Modify: `mcp-server/src/tools.ts` (get_page 개정, update_page 개정, 신규 4종, SERVER_INSTRUCTIONS, 버전)
- Modify: `mcp-server/package.json` (version 1.2.0)
- Create(임시): `mcp-server/roundtrip.mjs`, `prisma/make-temp-token.ts`

**Interfaces:**
- Consumes: API 엔드포인트 `GET /pages/{slug}?version=`, `PUT /pages/{slug}`(expectedVersion), `GET /pages/{slug}/revisions`, `POST /pages/{slug}/revert`, `POST /pages/{slug}/append`, `POST /pages/{slug}/replace` (Task 3-5).
- Produces: MCP 도구 `get_page(space, slug, version?)`, `update_page(..., expectedVersion?)`, `get_page_history(space, slug)`, `revert_page(space, slug, version, expectedVersion?)`, `append_to_page(space, slug, content, expectedVersion?)`, `replace_in_page(space, slug, old_string, new_string, expectedVersion?)`.

- [ ] **Step 1: SERVER_INSTRUCTIONS 갱신**

`mcp-server/src/tools.ts`의 `SERVER_INSTRUCTIONS` 상수를 아래로 교체:

```ts
export const SERVER_INSTRUCTIONS = `이 서버는 사내 마크다운 위키(simple-wiki)를 읽고 씁니다.

권장 흐름:
1. 무엇이 있는지 모르면 list_spaces로 접근 가능한 스페이스를 확인합니다.
2. 특정 내용을 찾을 땐 search_pages(제목·본문 전문검색, 스니펫 반환)를 먼저 씁니다.
3. 문서 원문이 필요하면 get_page(space, slug) — 응답의 version을 기억합니다.
4. 새 문서는 create_page, 같은 제목이 있으면 409 → update_page로 전환합니다.

안전한 편집(중요):
- 수정 전에 get_page로 현재 version을 확인하고, update_page/append_to_page/replace_in_page/revert_page 호출 시 expectedVersion으로 그 값을 넘깁니다.
- 응답이 409(conflict)면 다른 사람이 그사이 수정한 것입니다. get_page로 다시 읽고 병합한 뒤 최신 version으로 재시도합니다. 절대 그냥 덮어쓰지 마세요.
- 한 줄~한 문단만 고칠 땐 update_page(전체 교체) 대신 append_to_page(끝에 추가) 또는 replace_in_page(정확히 1곳 치환)를 씁니다. 토큰을 아끼고 실수로 다른 내용을 지우지 않습니다.
- replace_in_page의 old_string은 문서에서 정확히 1곳에만 매치돼야 합니다. 여러 곳이면 더 긴 고유 문맥을 포함하세요.

이력:
- get_page_history(space, slug)로 리비전 목록(version/작성자/시각/출처)을 봅니다.
- 특정 버전 원문은 get_page(space, slug, version)로 읽습니다.
- revert_page(space, slug, version)는 과거 버전 내용을 새 리비전으로 복원합니다(이력은 보존).

규칙:
- 권한은 토큰 소유자의 스페이스 권한을 따릅니다. 읽을 수 없는 스페이스는 목록·조회 모두 404로 숨겨집니다.
- 문서 사이 링크는 위키링크 문법 [[문서 제목]]을 씁니다.
- delete_page는 되돌릴 수 없으니 사용자가 명시적으로 요청할 때만 사용합니다.`;
```

- [ ] **Step 2: 서버 버전 bump**

같은 파일에서 `new McpServer({ name: "simple-wiki", version: "1.1.0" }, ...)`를 `version: "1.2.0"`으로 바꾼다. `mcp-server/package.json`의 `"version": "1.1.0"`도 `"1.2.0"`으로 바꾼다.

- [ ] **Step 3: get_page에 version 옵션 추가**

`get_page` 등록부를 아래로 교체:

```ts
  server.registerTool(
    "get_page",
    {
      title: "페이지 읽기",
      description:
        "페이지의 마크다운 원문과 현재 version을 반환합니다. version 인자를 주면 그 리비전의 원문을 반환합니다. slug는 list_pages/search_pages 결과의 slug를 사용하세요.",
      inputSchema: {
        space: z.string().describe("스페이스 키"),
        slug: z.string().describe("페이지 slug"),
        version: z.number().int().positive().optional().describe("특정 리비전 번호(생략 시 최신)"),
      },
    },
    async ({ space, slug, version }) => {
      const qs = version ? `?version=${version}` : "";
      return toResult(
        await api(`/api/spaces/${encodeURIComponent(space)}/pages/${encodeURIComponent(slug)}${qs}`),
      );
    },
  );
```

- [ ] **Step 4: update_page에 expectedVersion 추가**

`update_page` 등록부의 inputSchema에 `expectedVersion`을 추가하고 body에 포함:

```ts
  server.registerTool(
    "update_page",
    {
      title: "페이지 수정",
      description:
        "기존 페이지 전체 본문을 교체합니다(editor 권한). expectedVersion을 주면 그사이 변경 시 409로 실패합니다. 새 리비전이 이력에 남습니다.",
      inputSchema: {
        space: z.string().describe("스페이스 키"),
        slug: z.string().describe("수정할 페이지 slug"),
        title: z.string().describe("페이지 제목"),
        content: z.string().optional().describe("교체할 마크다운 본문 전체"),
        expectedVersion: z.number().int().positive().optional().describe("get_page로 읽은 현재 version"),
      },
    },
    async ({ space, slug, title, content, expectedVersion }) =>
      toResult(
        await api(`/api/spaces/${encodeURIComponent(space)}/pages/${encodeURIComponent(slug)}`, {
          method: "PUT",
          body: JSON.stringify({ title, content: content ?? "", expectedVersion }),
        }),
      ),
  );
```

- [ ] **Step 5: 신규 4종 도구 등록**

`delete_page` 등록부 위(또는 update_page 아래)에 추가:

```ts
  server.registerTool(
    "get_page_history",
    {
      title: "변경 이력",
      description: "페이지의 리비전 목록(version/제목/작성자/출처/시각)을 최신순으로 반환합니다. 본문은 포함하지 않으니 특정 버전 원문은 get_page(version)로 읽으세요.",
      inputSchema: {
        space: z.string().describe("스페이스 키"),
        slug: z.string().describe("페이지 slug"),
      },
    },
    async ({ space, slug }) =>
      toResult(
        await api(`/api/spaces/${encodeURIComponent(space)}/pages/${encodeURIComponent(slug)}/revisions`),
      ),
  );

  server.registerTool(
    "append_to_page",
    {
      title: "본문 이어붙이기",
      description: "페이지 본문 끝에 마크다운을 덧붙입니다(editor 권한). 전체 재작성 없이 안전하게 추가합니다. expectedVersion 권장.",
      inputSchema: {
        space: z.string().describe("스페이스 키"),
        slug: z.string().describe("페이지 slug"),
        content: z.string().describe("덧붙일 마크다운"),
        expectedVersion: z.number().int().positive().optional().describe("get_page로 읽은 현재 version"),
      },
    },
    async ({ space, slug, content, expectedVersion }) =>
      toResult(
        await api(`/api/spaces/${encodeURIComponent(space)}/pages/${encodeURIComponent(slug)}/append`, {
          method: "POST",
          body: JSON.stringify({ content, expectedVersion }),
        }),
      ),
  );

  server.registerTool(
    "replace_in_page",
    {
      title: "본문 부분 치환",
      description: "old_string을 문서에서 정확히 1곳 찾아 new_string으로 바꿉니다(editor 권한). 여러 곳 매치면 실패하니 고유한 문맥을 포함하세요. expectedVersion 권장.",
      inputSchema: {
        space: z.string().describe("스페이스 키"),
        slug: z.string().describe("페이지 slug"),
        old_string: z.string().describe("바꿀 기존 문자열(정확히 1곳 매치)"),
        new_string: z.string().describe("새 문자열"),
        expectedVersion: z.number().int().positive().optional().describe("get_page로 읽은 현재 version"),
      },
    },
    async ({ space, slug, old_string, new_string, expectedVersion }) =>
      toResult(
        await api(`/api/spaces/${encodeURIComponent(space)}/pages/${encodeURIComponent(slug)}/replace`, {
          method: "POST",
          body: JSON.stringify({ old_string, new_string, expectedVersion }),
        }),
      ),
  );

  server.registerTool(
    "revert_page",
    {
      title: "이전 버전으로 복원",
      description: "과거 리비전 version의 내용을 새 리비전으로 복원합니다(editor 권한). 이력은 삭제되지 않습니다. expectedVersion 권장.",
      inputSchema: {
        space: z.string().describe("스페이스 키"),
        slug: z.string().describe("페이지 slug"),
        version: z.number().int().positive().describe("복원할 과거 리비전 번호"),
        expectedVersion: z.number().int().positive().optional().describe("현재 version(충돌 방지)"),
      },
    },
    async ({ space, slug, version, expectedVersion }) =>
      toResult(
        await api(`/api/spaces/${encodeURIComponent(space)}/pages/${encodeURIComponent(slug)}/revert`, {
          method: "POST",
          body: JSON.stringify({ version, expectedVersion }),
        }),
      ),
  );
```

- [ ] **Step 6: MCP 서버 빌드**

Run: `cd mcp-server && npm run build && cd ..`
Expected: 성공(타입 오류 없음). `dist/tools.js` 갱신됨.

- [ ] **Step 7: 임시 PAT 생성 스크립트 작성**

`prisma/make-temp-token.ts`:

```ts
import { PrismaClient } from "@prisma/client";
import { createHash, randomBytes } from "node:crypto";

const prisma = new PrismaClient();

async function main() {
  const raw = "swk_" + randomBytes(32).toString("base64url");
  const hash = createHash("sha256").update(raw).digest("hex");
  const alice = await prisma.user.findFirst({ where: { name: { contains: "alice" } } });
  if (!alice) {
    // 이름 매칭이 안 되면 eng editor 권한을 가진 첫 사용자로 폴백
    throw new Error("alice 사용자를 찾지 못했습니다. Keycloak 로그인으로 User 행이 생성돼 있어야 합니다.");
  }
  await prisma.apiToken.create({
    data: { userId: alice.id, name: "roundtrip-temp", tokenHash: hash, prefix: raw.slice(0, 12) },
  });
  console.log(raw);
}

main().finally(() => prisma.$disconnect());
```

- [ ] **Step 8: 라운드트립 스크립트 작성**

`mcp-server/roundtrip.mjs`:

```js
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const token = process.env.WIKI_TOKEN;
const baseUrl = process.env.WIKI_BASE_URL ?? "http://localhost:3000";
if (!token) throw new Error("WIKI_TOKEN 필요");

const transport = new StdioClientTransport({
  command: "node",
  args: ["dist/index.js"],
  env: { ...process.env, WIKI_TOKEN: token, WIKI_BASE_URL: baseUrl },
});
const client = new Client({ name: "roundtrip", version: "1.0.0" });
await client.connect(transport);

console.log("instructions:", (client.getInstructions() ?? "").slice(0, 40), "...");
const tools = await client.listTools();
console.log("tools:", tools.tools.map((t) => t.name).sort().join(", "));

const slug = `mcp-rt-${Date.now()}`;
const call = (name, args) => client.callTool({ name, arguments: args });

await call("create_page", { space: "eng", title: `MCP 라운드트립 ${slug}`, content: "본문 원본" });
const spaces = await call("list_pages", { space: "eng" });
const realSlug = JSON.parse(spaces.content[0].text).pages.find((p) => p.title.includes(slug)).slug;

const got = JSON.parse((await call("get_page", { space: "eng", slug: realSlug })).content[0].text);
console.log("version after create:", got.version);

await call("append_to_page", { space: "eng", slug: realSlug, content: "덧붙임", expectedVersion: got.version });
await call("replace_in_page", { space: "eng", slug: realSlug, old_string: "원본", new_string: "교체됨" });
const hist = JSON.parse((await call("get_page_history", { space: "eng", slug: realSlug })).content[0].text);
console.log("revisions:", hist.revisions.length);

// stale expectedVersion → 409(isError)
const conflict = await call("update_page", { space: "eng", slug: realSlug, title: "x", content: "y", expectedVersion: 1 });
console.log("stale update isError:", conflict.isError === true);

await call("revert_page", { space: "eng", slug: realSlug, version: 1 });
await call("delete_page", { space: "eng", slug: realSlug });
console.log("ROUNDTRIP OK");
await client.close();
```

- [ ] **Step 9: 라운드트립 실행**

```bash
TOKEN=$(npx tsx prisma/make-temp-token.ts)
cd mcp-server && WIKI_TOKEN="$TOKEN" WIKI_BASE_URL="http://localhost:3000" node roundtrip.mjs; cd ..
```

Expected 출력 포함:
- `tools:` 목록에 `append_to_page, delete_page, get_page, get_page_history, list_pages, list_spaces, replace_in_page, revert_page, search_pages, update_page`
- `version after create: 1`
- `revisions: 3`
- `stale update isError: true`
- `ROUNDTRIP OK`

(dev 서버 :3000이 떠 있어야 함. alice가 eng editor 권한 보유.)

- [ ] **Step 10: 임시 토큰·스크립트 정리**

```bash
npx tsx -e "import{PrismaClient}from'@prisma/client';const p=new PrismaClient();await p.apiToken.deleteMany({where:{name:'roundtrip-temp'}});await p.\$disconnect();console.log('temp token deleted')"
rm prisma/make-temp-token.ts mcp-server/roundtrip.mjs
```

- [ ] **Step 11: 커밋**

```bash
git add mcp-server/src/tools.ts mcp-server/package.json
git commit -m "feat(mcp): 낙관적 잠금·이력·부분편집 도구 6종 + 지침 갱신 (v1.2.0)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 7: 웹 에디터 충돌 UX

**Files:**
- Modify: `src/actions/pages.ts` (`updatePage`가 충돌 시 결과 반환, 미사용 `saveRevision` 제거)
- Modify: `src/components/MarkdownEditor.tsx` (expectedVersion 프롭·hidden field·충돌 배너)
- Modify: `src/app/s/[spaceKey]/[slug]/edit/page.tsx` (expectedVersion 전달)
- Modify: `e2e/wiki.spec.ts` (웹 충돌 배너 테스트)

**Interfaces:**
- Consumes: `updatePageInSpace(expectedVersion)` (Task 3), `PageConflictError` (Task 2).
- Produces:
  - `type SaveResult = { conflict: true; currentVersion: number } | void`
  - `updatePage(spaceKey: string, slug: string, formData: FormData): Promise<SaveResult>`
  - `MarkdownEditor` 프롭 `expectedVersion?: number`, `onSave` 반환형 `Promise<SaveResult>`.

- [ ] **Step 1: `updatePage`를 충돌 반환형으로 개정 + `saveRevision` 제거**

`src/actions/pages.ts`의 import에 `PageConflictError`를 추가:

```ts
import { createPageInSpace, updatePageInSpace, revertPage } from "@/lib/pages";
import { PageConflictError } from "@/lib/page-edits";
```

`saveRevision` 함수(원본 27-40번째 줄)를 삭제하고, `updatePage`(원본 42-47번째 줄)를 아래로 교체:

```ts
export type SaveResult = { conflict: true; currentVersion: number } | void;

export async function updatePage(
  spaceKey: string,
  slug: string,
  formData: FormData,
): Promise<SaveResult> {
  const title = String(formData.get("title") ?? "").trim();
  const content = String(formData.get("content") ?? "");
  const ev = formData.get("expectedVersion");
  const expectedVersion = typeof ev === "string" && ev !== "" ? Number(ev) : undefined;

  const { session, space } = await requireSpaceRole(spaceKey, "editor");
  try {
    const found = await updatePageInSpace({
      spaceId: space.id,
      slug,
      title,
      content,
      authorId: session.userId,
      expectedVersion,
    });
    if (!found) throw new Error("페이지가 없습니다.");
  } catch (e) {
    if (e instanceof PageConflictError) {
      return { conflict: true, currentVersion: e.currentVersion };
    }
    throw e;
  }

  revalidatePath(`/s/${spaceKey}`);
  revalidatePath(`/s/${spaceKey}/${encodeURIComponent(slug)}`);
  redirect(`/s/${spaceKey}/${encodeURIComponent(slug)}`);
}
```

(`redirect`는 반드시 try/catch 밖에 둔다 — NEXT_REDIRECT를 catch가 삼키면 안 된다.)

- [ ] **Step 2: 빌드로 create_page 경로 무영향 확인**

Run: `npm run build`
Expected: 성공. `createPage`는 그대로이고, `saveRevision` 참조가 남지 않아야 한다.

- [ ] **Step 3: `MarkdownEditor`에 expectedVersion·충돌 배너 추가**

`src/components/MarkdownEditor.tsx`를 수정한다.

(a) `Props`와 `SaveResult` 타입:

```ts
type SaveResult = { conflict: true; currentVersion: number } | void;

interface Props {
  spaceKey: string;
  initialTitle: string;
  initialContent: string;
  expectedVersion?: number;
  onSave: (formData: FormData) => Promise<SaveResult>;
}
```

(b) 컴포넌트 시그니처와 상태:

```ts
export function MarkdownEditor({ spaceKey, initialTitle, initialContent, expectedVersion: initialExpectedVersion, onSave }: Props) {
  const [title, setTitle] = useState(initialTitle);
  const [content, setContent] = useState(initialContent);
  const [saving, setSaving] = useState(false);
  const [expectedVersion, setExpectedVersion] = useState(initialExpectedVersion);
  const [conflict, setConflict] = useState(false);
```

(c) form action 내부의 저장 처리(try 블록)를 교체:

```ts
        try {
          const result = await onSave(fd);
          if (result && "conflict" in result) {
            // 다른 사람이 먼저 저장함 — 최신 version으로 갱신하고 배너 표시.
            // 사용자가 다시 저장을 누르면 최신 위에 덮어쓴다(의도적 진행).
            setExpectedVersion(result.currentVersion);
            setConflict(true);
            setSaving(false);
            return;
          }
        } catch (e) {
          if (isRouterControlFlowError(e)) return;
          setSaving(false);
          alert("저장에 실패했습니다. 잠시 후 다시 시도하세요.");
        }
```

(d) `<input type="hidden" name="content" ...>` 아래에 expectedVersion hidden field 추가:

```tsx
      <input type="hidden" name="content" value={content} />
      <input type="hidden" name="expectedVersion" value={expectedVersion ?? ""} />
```

(e) 충돌 배너를 title input 위(폼 최상단)에 추가:

```tsx
      {conflict && (
        <div className="notice notice-warn" role="alert">
          다른 사람이 이 페이지를 먼저 수정했습니다(현재 v{expectedVersion}).{" "}
          <button
            type="button"
            className="linklike"
            onClick={() => window.location.reload()}
          >
            최신 내용 불러오기
          </button>
          . 그대로 다시 저장하면 상대의 수정 위에 덮어씁니다.
        </div>
      )}
```

배너의 "최신 내용 불러오기"는 폼 안에 있으므로 반드시 `type="button"`이어야 한다(기본값이면 폼이 제출된다). slug를 모르는 컴포넌트라 네비게이션 대신 `window.location.reload()`로 최신을 다시 불러온다.

- [ ] **Step 4: `notice` 스타일 추가(없으면)**

`src/app/globals.css`에 아래가 없으면 추가:

```css
.notice { border-radius: 10px; padding: 0.7rem 0.9rem; font-size: 0.9rem; margin-bottom: 1rem; }
.notice-warn { background: color-mix(in oklab, var(--accent-strong) 12%, transparent); border: 1px solid color-mix(in oklab, var(--accent-strong) 35%, transparent); }
.linklike { background: none; border: 0; padding: 0; font: inherit; color: var(--accent-strong); text-decoration: underline; cursor: pointer; }
```

(기존 CSS 토큰 `--accent-strong`을 재사용한다. 이미 유사 클래스가 있으면 새로 만들지 말고 그대로 쓴다.)

- [ ] **Step 5: 편집 페이지에서 expectedVersion 전달**

`src/app/s/[spaceKey]/[slug]/edit/page.tsx`의 `findUnique` select에 version이 포함되도록 하고(기본 전체 조회면 이미 포함), `MarkdownEditor`에 프롭 추가:

```tsx
  const page = await prisma.page.findUnique({
    where: { spaceId_slug: { spaceId: space.id, slug } },
    select: { title: true, content: true, version: true },
  });
  if (!page) notFound();
  return (
    <main className="py-10">
      <p className="eyebrow">{spaceKey} · edit</p>
      <h1 className="page-title mb-5 mt-1">페이지 편집</h1>
      <MarkdownEditor
        spaceKey={spaceKey}
        initialTitle={page.title}
        initialContent={page.content}
        expectedVersion={page.version}
        onSave={updatePage.bind(null, spaceKey, slug)}
      />
    </main>
  );
```

(new 페이지는 `expectedVersion` 프롭을 넘기지 않으므로 hidden field가 빈 문자열 → `createPage`는 이를 무시한다. 변경 불필요.)

- [ ] **Step 6: 빌드 확인**

Run: `npm run build`
Expected: 성공.

- [ ] **Step 7: e2e — 웹 충돌 배너**

`e2e/wiki.spec.ts` 끝에 추가:

```ts
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
  await page.getByRole("button", { name: "저장" }).click();
  await expect(page.getByRole("alert")).toContainText("먼저 수정");

  // 다시 저장 → 이제 expectedVersion=2라 통과, 페이지로 이동
  await page.getByRole("button", { name: "저장" }).click();
  await expect(page).toHaveURL(new RegExp(`/s/eng/${slug}$`));

  await page.evaluate(async (slug) => {
    await fetch(`/api/spaces/eng/pages/${slug}`, { method: "DELETE" });
  }, slug);
});
```

- [ ] **Step 8: e2e 실행**

Run: `npm run e2e -- -g "웹 충돌 UX"`
Expected: 1 passed.

- [ ] **Step 9: 전체 회귀 확인(단위 + e2e)**

Run: `npm test` 그리고 `npm run e2e`
Expected: 단위 전부 PASS(기존 + page-edits 14), e2e 전부 PASS(기존 5 + 신규 5). e2e가 만든 데이터는 각 테스트가 DELETE로 정리.

- [ ] **Step 10: 커밋**

```bash
git add src/actions/pages.ts src/components/MarkdownEditor.tsx src/app/s/'[spaceKey]'/'[slug]'/edit/page.tsx src/app/globals.css e2e/wiki.spec.ts
git commit -m "feat(web): 편집 충돌 감지 배너 + expectedVersion 전송(양방향 보호)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## 참고: 실행 전 확인

- dev 서버가 :3000에 떠 있어야 e2e/라운드트립이 동작한다. 없으면 `npm run dev`(백그라운드).
- PostgreSQL은 5433 포트. `.env`의 `DATABASE_URL`이 5433을 가리키는지 확인.
- alice가 eng 스페이스 editor 권한을 갖고 있어야 API/MCP 편집 테스트가 통과한다(과거 세션에서 이 권한이 사라진 적 있음 — 없으면 SpacePermission 복구).
