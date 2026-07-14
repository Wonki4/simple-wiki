# 프로덕션 스케일링 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 사내 3만 명 + MCP/LLM 부하를 감당하도록 토큰별 rate limit·읽기 캐싱·검색 캐싱/튜닝·커넥션 설정·mcp HPA·k6 부하테스트를 기존 코드/Helm 위에 얹는다(Redis·PgBouncer 없이).

**Architecture:** 순수 로직(rate-limit 토큰버킷, 검색 캐시키)은 DB 없이 단위 테스트하고, 캐싱은 Next.js 내장 `unstable_cache` + `revalidateTag`로, 확장은 Helm HPA/커넥션 설정으로 처리한다. 스펙: `docs/superpowers/specs/2026-07-13-production-scaling-design.md`.

**Tech Stack:** Next.js 15(App Router, `unstable_cache`/`revalidateTag`), Prisma 6 + PostgreSQL(전문검색), vitest(순수 단위), Helm, k6(부하).

## Global Constraints

- **새 인프라 0 추가**: Redis·PgBouncer를 쓰지 않는다. 앱 코드 + Helm/Postgres 설정만.
- **읽기 캐시 TTL 60초**, **검색 캐시 TTL 30초** (스펙 값 그대로).
- **읽기 캐시 키는 (pageId, version)**, 권한 판정(`requireSpaceRole`)은 캐시 밖에서 매 요청 실행(무권한자 유출 방지).
- **검색 캐시 키에 정렬된 readableSpaceIds + query를 반드시 포함**(권한 격리). 태그 무효화 없이 30초 TTL 만료.
- **rate limit은 PAT/MCP 토큰 행위자에만**(`ApiActor.via === "token"`). 초과 시 **HTTP 429 + `Retry-After`**. 한도는 env(기본 토큰당 60 req / 10초 = capacity 60, refill 6/s).
- **검색 쿼리 튜닝**: 서브쿼리로 `WHERE+ORDER BY+LIMIT 50`을 먼저 확정하고 바깥에서 그 50행에만 `ts_headline` 적용. 기존 GIN/pg_trgm 인덱스·LIMIT 50 유지.
- **Docker 다운 상황**: 이 세션은 Postgres·Keycloak 컨테이너가 없다. 각 태스크는 `npx tsc --noEmit` + 단위 테스트 + `helm template`로 검증하고, **DB가 필요한 e2e와 k6 실행은 인프라 복구 후로 미룬다**(계획 말미 "인프라 복구 후 검증" 절).
- **타입체크 게이트는 `npx tsc --noEmit`** (라이브 dev 서버가 있으면 `npm run build`는 `.next` 공유로 dev를 깨뜨리므로 금지).
- 커밋 트레일러: `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.

## 파일 구조 (책임)

| 파일 | 책임 | 태스크 |
|---|---|---|
| `src/lib/rate-limit.ts` (신규) | 순수 토큰버킷 + 싱글턴 + env | T1 |
| `src/lib/api-auth.ts` (수정) | ApiActor에 tokenId, `rateLimitResponse` 적용 | T1 |
| `src/app/api/search/route.ts` (수정) | 검색 경로 rate limit 적용 | T1 |
| `src/lib/page-render-cache.ts` (신규) | 페이지 렌더 HTML 캐시 | T2 |
| `src/lib/pages.ts` (수정) | commitRevision·delete 무효화 훅 | T2 |
| `src/app/s/[spaceKey]/[slug]/page.tsx` (수정) | 캐시 함수 사용 | T2 |
| `src/lib/search.ts` (수정) | 캐시 래핑 + ts_headline 서브쿼리 | T3 |
| `deploy/helm/simple-wiki/values.yaml`·`deploy/README.md` (수정) | connection_limit 사이징 | T4 |
| `deploy/helm/simple-wiki/templates/mcp-hpa.yaml` (신규)·`values.yaml` (수정) | mcp HPA | T5 |
| `deploy/loadtest/*.js`·README (신규) | k6 시나리오 3종 | T6 |

---

### Task 1: 토큰별 rate limit (순수 토큰버킷 + 적용)

**Files:**
- Create: `src/lib/rate-limit.ts`
- Create: `tests/rate-limit.test.ts`
- Modify: `src/lib/api-auth.ts` (ApiActor에 `tokenId`, `resolveApiActor`에서 세팅, `rateLimitResponse` 추가, `requireApiSpaceRole`에서 적용)
- Modify: `src/app/api/search/route.ts` (검색 경로에도 적용)

**Interfaces:**
- Produces:
  - `class RateLimiter { constructor(opts: RateLimiterOptions); take(key: string, now: number): RateLimitResult; sweep(now: number, idleMs: number): void }`
  - `interface RateLimitResult { allowed: boolean; remaining: number; retryAfterSec: number }`
  - `interface RateLimiterOptions { capacity: number; refillPerSec: number }`
  - `checkTokenRateLimit(tokenKey: string): RateLimitResult`
  - `rateLimitResponse(actor: ApiActor): Response | null` (api-auth)
  - `ApiActor` 확장: `tokenId: string | null`

- [ ] **Step 1: 실패하는 단위 테스트 작성**

`tests/rate-limit.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { RateLimiter } from "@/lib/rate-limit";

describe("RateLimiter.take", () => {
  it("capacity만큼 즉시 허용, 그 다음은 거부", () => {
    const rl = new RateLimiter({ capacity: 3, refillPerSec: 1 });
    const t = 1000;
    expect(rl.take("a", t).allowed).toBe(true);
    expect(rl.take("a", t).allowed).toBe(true);
    expect(rl.take("a", t).allowed).toBe(true);
    const denied = rl.take("a", t);
    expect(denied.allowed).toBe(false);
    expect(denied.retryAfterSec).toBe(1); // 1초 후 토큰 1개 리필
  });

  it("시간이 지나면 리필된다", () => {
    const rl = new RateLimiter({ capacity: 2, refillPerSec: 1 });
    rl.take("a", 0);
    rl.take("a", 0); // 소진
    expect(rl.take("a", 0).allowed).toBe(false);
    expect(rl.take("a", 2000).allowed).toBe(true); // 2초 → 2토큰 리필
  });

  it("키별로 독립적이다", () => {
    const rl = new RateLimiter({ capacity: 1, refillPerSec: 1 });
    expect(rl.take("a", 0).allowed).toBe(true);
    expect(rl.take("a", 0).allowed).toBe(false);
    expect(rl.take("b", 0).allowed).toBe(true); // 다른 키는 영향 없음
  });

  it("리필이 capacity를 넘지 않는다", () => {
    const rl = new RateLimiter({ capacity: 2, refillPerSec: 1 });
    rl.take("a", 0);
    // 100초 지나도 최대 capacity=2 까지만
    expect(rl.take("a", 100000).allowed).toBe(true);
    expect(rl.take("a", 100000).allowed).toBe(true);
    expect(rl.take("a", 100000).allowed).toBe(false);
  });
});

describe("RateLimiter.sweep", () => {
  it("idle 초과 + 가득 찬 버킷을 제거한다", () => {
    const rl = new RateLimiter({ capacity: 2, refillPerSec: 1 });
    rl.take("a", 0); // 버킷 생성
    rl.sweep(100000, 60000); // 100초 경과(>60s idle), 리필로 가득 참 → 제거
    // 제거되면 새 버킷이 capacity로 시작: 연속 2회 허용 가능
    expect(rl.take("a", 100000).allowed).toBe(true);
    expect(rl.take("a", 100000).allowed).toBe(true);
    expect(rl.take("a", 100000).allowed).toBe(false);
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npm test -- rate-limit`
Expected: FAIL — `Cannot find module '@/lib/rate-limit'`.

- [ ] **Step 3: `rate-limit.ts` 구현**

`src/lib/rate-limit.ts`:

```ts
// 순수 토큰버킷 rate limiter(프로세스 메모리). 목적은 정밀 공평성이 아니라
// 폭주 토큰(루프에 빠진 LLM 에이전트) 차단이다. replica마다 독립 버킷을 쓴다.

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterSec: number; // allowed=false일 때 다음 토큰까지 대략 초
}

export interface RateLimiterOptions {
  capacity: number; // 버킷 최대 토큰(=버스트 허용량)
  refillPerSec: number; // 초당 리필 토큰 수
}

interface Bucket {
  tokens: number;
  last: number; // 마지막 갱신 시각(ms)
}

export class RateLimiter {
  private buckets = new Map<string, Bucket>();
  constructor(private opts: RateLimiterOptions) {}

  // now: 현재 시각(ms). 테스트에서 주입한다.
  take(key: string, now: number): RateLimitResult {
    const { capacity, refillPerSec } = this.opts;
    let b = this.buckets.get(key);
    if (!b) {
      b = { tokens: capacity, last: now };
      this.buckets.set(key, b);
    }
    const elapsedSec = Math.max(0, (now - b.last) / 1000);
    b.tokens = Math.min(capacity, b.tokens + elapsedSec * refillPerSec);
    b.last = now;
    if (b.tokens >= 1) {
      b.tokens -= 1;
      return { allowed: true, remaining: Math.floor(b.tokens), retryAfterSec: 0 };
    }
    const retryAfterSec = Math.ceil((1 - b.tokens) / refillPerSec);
    return { allowed: false, remaining: 0, retryAfterSec };
  }

  // idleMs 이상 미사용 + 가득 찬 버킷을 제거해 메모리 누수를 막는다.
  sweep(now: number, idleMs: number): void {
    for (const [k, b] of this.buckets) {
      const tokens = Math.min(this.opts.capacity, b.tokens + ((now - b.last) / 1000) * this.opts.refillPerSec);
      if (now - b.last > idleMs && tokens >= this.opts.capacity) this.buckets.delete(k);
    }
  }
}

// ── 프로세스 싱글턴 + env 설정 ──
// 기본: 토큰당 60 req / 10초 → capacity 60, refill 6/s
const CAPACITY = Number(process.env.RATE_LIMIT_CAPACITY ?? 60);
const REFILL = Number(process.env.RATE_LIMIT_REFILL_PER_SEC ?? 6);
const limiter = new RateLimiter({ capacity: CAPACITY, refillPerSec: REFILL });

let sweepTimer: ReturnType<typeof setInterval> | null = null;
function ensureSweep(): void {
  if (sweepTimer) return;
  sweepTimer = setInterval(() => limiter.sweep(Date.now(), 60_000), 60_000);
  if (typeof (sweepTimer as { unref?: () => void }).unref === "function") {
    (sweepTimer as { unref: () => void }).unref();
  }
}

export function checkTokenRateLimit(tokenKey: string): RateLimitResult {
  ensureSweep();
  return limiter.take(tokenKey, Date.now());
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npm test -- rate-limit`
Expected: PASS (5 tests).

- [ ] **Step 5: `ApiActor`에 tokenId 추가 + resolveApiActor 세팅**

`src/lib/api-auth.ts`에서 `ApiActor` 타입을 확장:

```ts
export type ApiActor = SessionInfo & { via: "token" | "session"; tokenName: string | null; tokenId: string | null };
```

`resolveApiActor`의 토큰 분기 반환에 `tokenId: token.id`를, 세션 분기 반환에 `tokenId: null`을 추가한다:

```ts
      return {
        userId: token.user.id,
        groups: token.user.groups,
        isWikiAdmin: token.user.isWikiAdmin,
        via: "token",
        tokenName: token.name,
        tokenId: token.id,
      };
```

세션 폴백:

```ts
  const s = await getSessionInfo();
  return s ? { ...s, via: "session", tokenName: null, tokenId: null } : null;
```

- [ ] **Step 6: `rateLimitResponse` 추가 + requireApiSpaceRole 적용**

`src/lib/api-auth.ts` 상단 import에 추가:

```ts
import { checkTokenRateLimit } from "@/lib/rate-limit";
```

`resolveApiActor` 아래에 헬퍼 추가:

```ts
/**
 * 토큰 행위자가 rate limit을 초과하면 429 Response를 반환한다. 아니면 null.
 * 세션(사람) 행위자는 검사하지 않는다.
 */
export function rateLimitResponse(actor: ApiActor): Response | null {
  if (actor.via !== "token" || !actor.tokenId) return null;
  const r = checkTokenRateLimit(actor.tokenId);
  if (r.allowed) return null;
  return Response.json(
    { error: "요청이 너무 많습니다. 잠시 후 다시 시도하세요." },
    { status: 429, headers: { "Retry-After": String(r.retryAfterSec) } },
  );
}
```

`requireApiSpaceRole`에서 actor 판정 직후(스페이스 조회 전)에 rate limit 검사를 넣는다. 기존:

```ts
  const actor = await resolveApiActor(req);
  if (!actor) {
    return { ok: false, response: Response.json({ error: "인증이 필요합니다." }, { status: 401 }) };
  }
```

아래로 교체:

```ts
  const actor = await resolveApiActor(req);
  if (!actor) {
    return { ok: false, response: Response.json({ error: "인증이 필요합니다." }, { status: 401 }) };
  }
  const limited = rateLimitResponse(actor);
  if (limited) return { ok: false, response: limited };
```

- [ ] **Step 7: 검색 경로에도 rate limit 적용**

`src/app/api/search/route.ts`에서 import에 `rateLimitResponse` 추가:

```ts
import { resolveApiActor, rateLimitResponse } from "@/lib/api-auth";
```

actor 판정 직후에 검사:

```ts
  const actor = await resolveApiActor(req);
  if (!actor) return Response.json({ error: "인증이 필요합니다." }, { status: 401 });
  const limited = rateLimitResponse(actor);
  if (limited) return limited;
```

- [ ] **Step 8: 타입체크**

Run: `npx tsc --noEmit`
Expected: exit 0. (ApiActor를 만드는 다른 지점이 있으면 tokenId 누락으로 에러 → 그 지점도 tokenId 세팅.)

- [ ] **Step 9: 커밋**

```bash
git add src/lib/rate-limit.ts tests/rate-limit.test.ts src/lib/api-auth.ts src/app/api/search/route.ts
git commit -m "feat(api): 토큰별 rate limit(토큰버킷·429) — PAT/MCP 폭주 차단

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: 읽기 캐싱 (페이지 렌더 HTML)

**Files:**
- Create: `src/lib/page-render-cache.ts`
- Modify: `src/lib/pages.ts` (commitRevision 성공 후 + deletePage 경로에서 태그 무효화)
- Modify: `src/app/s/[spaceKey]/[slug]/page.tsx` (인라인 렌더 블록을 캐시 함수로 교체)
- Modify: `src/actions/pages.ts` (deletePage에서 무효화)

**Interfaces:**
- Consumes: `renderMarkdown`(`src/lib/markdown.ts`), `extractWikiLinks`(`src/lib/wiki-links.ts`), `Page.version`(Task는 이미 병합됨).
- Produces:
  - `getRenderedPageHtml(args: { pageId: string; version: number; content: string; spaceId: string; spaceKey: string }): Promise<string>`
  - `pageCacheTag(pageId: string): string` → `"page:{pageId}"`
  - `invalidatePageCache(pageId: string): void` (revalidateTag 래퍼)

- [ ] **Step 1: `page-render-cache.ts` 작성**

`src/lib/page-render-cache.ts`:

```ts
import { unstable_cache, revalidateTag } from "next/cache";
import { prisma } from "@/lib/db";
import { renderMarkdown } from "@/lib/markdown";
import { extractWikiLinks } from "@/lib/wiki-links";

export function pageCacheTag(pageId: string): string {
  return `page:${pageId}`;
}

/**
 * 페이지 본문 렌더(HTML)를 캐시한다.
 * 키 = (pageId, version): version은 불변이므로 편집 시 자연 미스된다.
 * TTL 60초: 다중 replica 로컬 캐시 staleness 상한 + 위키링크 해석(다른 페이지
 * 생성/삭제)의 cross-page staleness 상한. 편집 replica는 revalidateTag로 즉시 무효화한다.
 * 권한 판정은 이 함수 밖에서 매 요청 수행한다(여기엔 권한 로직이 없다).
 */
export function getRenderedPageHtml(args: {
  pageId: string;
  version: number;
  content: string;
  spaceId: string;
  spaceKey: string;
}): Promise<string> {
  const { pageId, version, content, spaceId, spaceKey } = args;
  const cached = unstable_cache(
    async () => {
      const targets = extractWikiLinks(content).map((l) => l.slug);
      const existing = targets.length
        ? await prisma.page.findMany({
            where: { spaceId, slug: { in: targets } },
            select: { slug: true },
          })
        : [];
      return renderMarkdown(content, {
        spaceKey,
        existingSlugs: new Set(existing.map((p) => p.slug)),
      });
    },
    ["page-html", pageId, String(version)],
    { tags: [pageCacheTag(pageId)], revalidate: 60 },
  );
  return cached();
}

/**
 * 페이지 캐시를 즉시 무효화한다. 쓰기/삭제 경로에서 호출한다.
 * 요청 컨텍스트(서버 액션/라우트 핸들러) 밖에서 호출될 경우를 대비해 방어적으로 감싼다
 * (그런 경우에도 60초 TTL이 backstop).
 */
export function invalidatePageCache(pageId: string): void {
  try {
    revalidateTag(pageCacheTag(pageId));
  } catch {
    // 요청 컨텍스트 밖: TTL 만료에 맡긴다.
  }
}
```

- [ ] **Step 2: `pages.ts` commitRevision에 무효화 훅**

`src/lib/pages.ts` 상단 import에 추가:

```ts
import { invalidatePageCache } from "@/lib/page-render-cache";
```

`commitRevision`에서 `prisma.$transaction(...)`이 끝난 뒤(반환 전)에 무효화를 넣는다. `commitRevision`의 `return nextV;` 직전에:

```ts
  invalidatePageCache(input.page.id);
  return nextV;
```

(트랜잭션 콜백 **안**이 아니라 트랜잭션 성공 **후**에 호출해야 한다.)

- [ ] **Step 3: deletePage에서 무효화**

`src/actions/pages.ts`의 `deletePage`를 수정한다. 현재:

```ts
export async function deletePage(spaceKey: string, slug: string) {
  const { space } = await requireSpaceRole(spaceKey, "editor");
  await prisma.page.deleteMany({ where: { spaceId: space.id, slug } });
  revalidatePath(`/s/${spaceKey}`);
  redirect(`/s/${spaceKey}`);
}
```

삭제 전에 pageId를 조회해 캐시를 무효화하도록 교체:

```ts
export async function deletePage(spaceKey: string, slug: string) {
  const { space } = await requireSpaceRole(spaceKey, "editor");
  const page = await prisma.page.findUnique({
    where: { spaceId_slug: { spaceId: space.id, slug } },
    select: { id: true },
  });
  await prisma.page.deleteMany({ where: { spaceId: space.id, slug } });
  if (page) invalidatePageCache(page.id);
  revalidatePath(`/s/${spaceKey}`);
  redirect(`/s/${spaceKey}`);
}
```

`src/actions/pages.ts` 상단 import에 추가:

```ts
import { invalidatePageCache } from "@/lib/page-render-cache";
```

- [ ] **Step 4: page.tsx에서 캐시 함수 사용**

`src/app/s/[spaceKey]/[slug]/page.tsx`에서 인라인 렌더 블록(원본 48-58번째 줄: `const targets = ...`부터 `const html = await renderMarkdown(...)`까지)을 아래로 교체:

```ts
  const html = await getRenderedPageHtml({
    pageId: page.id,
    version: page.version,
    content: page.content,
    spaceId: space.id,
    spaceKey,
  });
```

import를 정리한다: `renderMarkdown`, `extractWikiLinks` import 줄을 제거하고(page.tsx에서 더는 직접 안 씀) 아래를 추가:

```ts
import { getRenderedPageHtml } from "@/lib/page-render-cache";
```

(주의: `extractWikiLinks`가 page.tsx의 다른 곳에서 안 쓰이는지 확인 후 제거. 현재는 렌더 블록에서만 사용하므로 제거 가능.)

- [ ] **Step 5: 타입체크**

Run: `npx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 6: 단위 테스트 무회귀**

Run: `npm test`
Expected: 기존 전부 PASS(캐싱은 순수 로직 변경이 아니므로 기존 테스트에 영향 없음).

- [ ] **Step 7: 커밋**

```bash
git add src/lib/page-render-cache.ts src/lib/pages.ts src/actions/pages.ts src/app/s/'[spaceKey]'/'[slug]'/page.tsx
git commit -m "feat(perf): 페이지 렌더 HTML 읽기 캐싱(TTL 60s·버전키·쓰기 무효화)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: 검색 캐싱 + 쿼리 튜닝

**Files:**
- Modify: `src/lib/search.ts` (캐시 래핑 + ts_headline 서브쿼리)
- Create: `tests/search-cache-key.test.ts`

**Interfaces:**
- Produces:
  - `searchCacheKeyParts(query: string, spaceIds: string[]): string[]` — 정렬된 spaceIds + query 포함(권한 격리)
  - `searchPages(q, readableSpaceIds)` 시그니처 불변(내부만 캐싱)

- [ ] **Step 1: 캐시 키 실패 테스트 작성**

`tests/search-cache-key.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { searchCacheKeyParts } from "@/lib/search";

describe("searchCacheKeyParts (권한 격리)", () => {
  it("spaceIds를 정렬해 순서 무관하게 같은 키를 만든다", () => {
    const a = searchCacheKeyParts("hello", ["s2", "s1"]);
    const b = searchCacheKeyParts("hello", ["s1", "s2"]);
    expect(a).toEqual(b);
  });

  it("spaceIds 집합이 다르면 키가 다르다", () => {
    const a = searchCacheKeyParts("hello", ["s1", "s2"]);
    const b = searchCacheKeyParts("hello", ["s1"]);
    expect(a).not.toEqual(b);
  });

  it("query가 다르면 키가 다르다", () => {
    const a = searchCacheKeyParts("hello", ["s1"]);
    const b = searchCacheKeyParts("world", ["s1"]);
    expect(a).not.toEqual(b);
  });

  it("키에 query와 spaceIds가 모두 반영된다", () => {
    const parts = searchCacheKeyParts("hi", ["s1", "s2"]);
    expect(parts.join("|")).toContain("hi");
    expect(parts.join("|")).toContain("s1");
    expect(parts.join("|")).toContain("s2");
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npm test -- search-cache-key`
Expected: FAIL — `searchCacheKeyParts` export 없음.

- [ ] **Step 3: `search.ts` 재작성(캐싱 + 튜닝)**

`src/lib/search.ts` 전체를 아래로 교체:

```ts
import { unstable_cache } from "next/cache";
import { prisma } from "@/lib/db";

export interface SearchResult {
  spaceKey: string;
  spaceName: string;
  slug: string;
  title: string;
  snippet: string;
}

// 캐시 키 파트: 권한 격리를 위해 정렬된 readableSpaceIds + query를 포함한다.
// 같은 스페이스 집합을 읽을 수 있는 사용자끼리만 캐시를 공유한다.
export function searchCacheKeyParts(query: string, spaceIds: string[]): string[] {
  return ["search", [...spaceIds].sort().join(","), query];
}

// 실제 검색 쿼리. ts_headline(스니펫 생성, CPU)을 서브쿼리로 상위 50행에만 적용한다.
async function runSearch(query: string, readableSpaceIds: string[]): Promise<SearchResult[]> {
  return prisma.$queryRaw<SearchResult[]>`
    SELECT
      hit."spaceKey",
      hit."spaceName",
      hit."slug",
      hit."title",
      ts_headline(
        'simple', hit."content", websearch_to_tsquery('simple', ${query}),
        'StartSel=[[HL]],StopSel=[[/HL]],MaxWords=30,MinWords=10'
      ) AS "snippet"
    FROM (
      SELECT
        s."key"  AS "spaceKey",
        s."name" AS "spaceName",
        p."slug",
        p."title",
        p."content"
      FROM "Page" p
      JOIN "Space" s ON s."id" = p."spaceId"
      WHERE p."spaceId" = ANY(${readableSpaceIds})
        AND (
          p."searchVector" @@ websearch_to_tsquery('simple', ${query})
          OR p."title" ILIKE '%' || ${query} || '%'
          OR p."content" ILIKE '%' || ${query} || '%'
        )
      ORDER BY ts_rank(p."searchVector", websearch_to_tsquery('simple', ${query})) DESC
      LIMIT 50
    ) hit
  `;
}

export async function searchPages(q: string, readableSpaceIds: string[]): Promise<SearchResult[]> {
  const query = q.trim();
  if (!query || readableSpaceIds.length === 0) return [];
  // 검색 결과를 30초 캐시. 권한 격리 키로 캐시 공유를 제한한다.
  const cached = unstable_cache(() => runSearch(query, readableSpaceIds), searchCacheKeyParts(query, readableSpaceIds), {
    revalidate: 30,
  });
  return cached();
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npm test -- search-cache-key`
Expected: PASS (4 tests).

- [ ] **Step 5: 타입체크**

Run: `npx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 6: 커밋**

```bash
git add src/lib/search.ts tests/search-cache-key.test.ts
git commit -m "feat(perf): 검색 결과 캐싱(권한격리 키·TTL 30s) + ts_headline 서브쿼리 튜닝

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: 커넥션 설정 튜닝 (문서 + values)

**Files:**
- Modify: `deploy/helm/simple-wiki/values.yaml` (DATABASE_URL connection_limit 가이드 주석)
- Modify: `deploy/README.md` (사이징 공식 + PgBouncer 재검토 임계치)

**Interfaces:** 코드 변경 없음(Prisma는 접속 문자열 `?connection_limit=N`로 제어).

- [ ] **Step 1: values.yaml에 가이드 주석 추가**

`deploy/helm/simple-wiki/values.yaml`의 secret/DATABASE_URL 관련 위치(파일 상단 `image:` 블록 아래 등 secret 설명이 있는 곳)에 아래 주석 블록을 추가한다. 정확한 위치는 기존 `existingSecret`/secret 설명 근처:

```yaml
# ── DB 커넥션 사이징 (스케일링) ──
# DATABASE_URL 시크릿 값 끝에 ?connection_limit=<N> 을 붙여 replica당 커넥션 상한을 고정한다.
#   예: postgresql://user:pass@host:5432/wiki?connection_limit=5
# Postgres max_connections 는 (autoscaling.maxReplicas × connection_limit + 여유) 이상으로 사이징한다.
#   예: maxReplicas 10 × 5 + mcp/마이그레이션/관리 여유 → max_connections=150~200
# replica를 20~30 이상으로 키우거나 서버리스를 도입하면 그때 PgBouncer(transaction pooling)를 검토한다.
```

- [ ] **Step 2: deploy/README.md에 사이징 절 추가**

`deploy/README.md`의 Helm 절 뒤(에어갭 절 앞 또는 뒤)에 추가:

```markdown
## DB 커넥션 사이징 (스케일링)

수평 확장(HPA) 시 각 app/mcp 파드가 Prisma 커넥션 풀을 연다. Postgres `max_connections` 를
소진하지 않도록 두 값을 함께 잡는다.

- **replica당 상한**: `DATABASE_URL` 끝에 `?connection_limit=5` (예)를 붙인다. 코드 변경 없이
  접속 문자열로 제어된다.
- **Postgres 사이징**: `max_connections ≥ autoscaling.maxReplicas × connection_limit + 여유`.
  여유는 마이그레이션 initContainer, 관리/모니터링 커넥션 몫이다.
  예) maxReplicas 10 × connection_limit 5 = 50, 여유 포함 `max_connections=150~200`.
- 읽기 캐싱으로 대부분의 읽기가 DB에 닿지 않으므로 활성 커넥션은 위 상한보다 훨씬 낮게 유지된다.

**PgBouncer 재검토 임계치**: HPA `maxReplicas` 를 20~30 이상으로 키우거나 서버리스/엣지를
도입해 커넥션이 빠르게 생성·소멸하면, 그때 PgBouncer(transaction pooling, `pgbouncer=true`)를
도입한다. 그 전까지는 위 설정으로 충분하다.
```

- [ ] **Step 3: Helm 렌더 무결성 확인(가능 시)**

Run: `helm template deploy/helm/simple-wiki >/dev/null && echo OK` (helm 미설치면 이 스텝은 건너뛰고 YAML 주석만 육안 확인)
Expected: `OK` (주석 추가는 렌더에 영향 없음).

- [ ] **Step 4: 커밋**

```bash
git add deploy/helm/simple-wiki/values.yaml deploy/README.md
git commit -m "docs(deploy): DB 커넥션 사이징 가이드(connection_limit·max_connections·PgBouncer 임계치)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: mcp HorizontalPodAutoscaler

**Files:**
- Create: `deploy/helm/simple-wiki/templates/mcp-hpa.yaml`
- Modify: `deploy/helm/simple-wiki/values.yaml` (`mcp.autoscaling` 블록 추가)

**Interfaces:**
- Consumes: 기존 helper `simple-wiki.mcpServiceName`(mcp-deployment.yaml에서 쓰는 이름과 동일해야 함), `simple-wiki.labels`.
- 참고: app HPA(`templates/hpa.yaml`)와 `autoscaling:` 블록은 이미 존재한다. 이 태스크는 mcp용만 추가한다.

- [ ] **Step 1: mcp deployment의 이름 helper 확인**

`deploy/helm/simple-wiki/templates/mcp-deployment.yaml`에서 `metadata.name`에 쓰는 helper 이름을 확인한다(예: `simple-wiki.mcpServiceName` 또는 유사). 아래 Step 2의 `scaleTargetRef.name`이 그 이름과 정확히 일치해야 한다. 다르면 Step 2의 helper 이름을 실제 값으로 바꾼다.

- [ ] **Step 2: mcp-hpa.yaml 작성**

`deploy/helm/simple-wiki/templates/mcp-hpa.yaml`:

```yaml
{{- if and .Values.mcp.enabled .Values.mcp.autoscaling.enabled }}
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: {{ include "simple-wiki.mcpServiceName" . }}
  labels:
    {{- include "simple-wiki.labels" . | nindent 4 }}
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: {{ include "simple-wiki.mcpServiceName" . }}
  minReplicas: {{ .Values.mcp.autoscaling.minReplicas }}
  maxReplicas: {{ .Values.mcp.autoscaling.maxReplicas }}
  metrics:
    - type: Resource
      resource:
        name: cpu
        target:
          type: Utilization
          averageUtilization: {{ .Values.mcp.autoscaling.targetCPUUtilizationPercentage }}
{{- end }}
```

(Step 1에서 확인한 helper 이름이 `simple-wiki.mcpServiceName`이 아니면 두 곳 모두 실제 이름으로 교체.)

- [ ] **Step 3: values.yaml에 mcp.autoscaling 추가**

`deploy/helm/simple-wiki/values.yaml`의 `mcp:` 블록 안에 추가한다(`mcp.replicaCount` 근처):

```yaml
  # mcp-server는 무상태(stateless streamable-http)라 수평 확장 가능.
  autoscaling:
    enabled: false
    minReplicas: 2
    maxReplicas: 4
    targetCPUUtilizationPercentage: 75
```

- [ ] **Step 4: Helm 렌더 검증**

Run: `helm template deploy/helm/simple-wiki --set mcp.autoscaling.enabled=true | grep -A3 "kind: HorizontalPodAutoscaler" | head` (helm 미설치면 건너뛰고 템플릿 문법 육안 확인)
Expected: mcp HPA가 렌더된다(app HPA와 함께). `--set autoscaling.enabled=false`(app)일 때 app HPA는 렌더되지 않고 mcp만 나오는지 확인.

- [ ] **Step 5: 커밋**

```bash
git add deploy/helm/simple-wiki/templates/mcp-hpa.yaml deploy/helm/simple-wiki/values.yaml
git commit -m "feat(deploy): mcp-server HPA(무상태 수평확장) + autoscaling values

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 6: k6 부하 테스트 시나리오

**Files:**
- Create: `deploy/loadtest/read-browse.js`
- Create: `deploy/loadtest/mcp-search-edit.js`
- Create: `deploy/loadtest/runaway-429.js`
- Create: `deploy/loadtest/README.md`

**Interfaces:** k6 스크립트(독립 실행). 실행은 인프라 복구 후.

- [ ] **Step 1: read-browse.js 작성**

`deploy/loadtest/read-browse.js`:

```js
// 읽기 브라우징 부하: 페이지 상세 반복 조회로 렌더 캐시 효과를 측정한다.
// 실행: k6 run -e BASE_URL=http://localhost:3000 -e COOKIE="<session cookie>" deploy/loadtest/read-browse.js
import http from "k6/http";
import { check, sleep } from "k6";

const BASE = __ENV.BASE_URL || "http://localhost:3000";
const COOKIE = __ENV.COOKIE || "";
const PATH = __ENV.PAGE_PATH || "/s/eng"; // 캐시 대상 페이지 경로로 교체

export const options = {
  stages: [
    { duration: "30s", target: 50 },
    { duration: "1m", target: 50 },
    { duration: "10s", target: 0 },
  ],
  thresholds: { http_req_duration: ["p(95)<500"] },
};

export default function () {
  const res = http.get(`${BASE}${PATH}`, { headers: COOKIE ? { Cookie: COOKIE } : {} });
  check(res, { "status 200": (r) => r.status === 200 });
  sleep(1);
}
```

- [ ] **Step 2: mcp-search-edit.js 작성**

`deploy/loadtest/mcp-search-edit.js`:

```js
// MCP search-first + 편집 부하: 검색 캐싱/튜닝과 쓰기 경로를 측정한다.
// 실행: k6 run -e BASE_URL=... -e TOKEN=swk_... -e SPACE=eng deploy/loadtest/mcp-search-edit.js
import http from "k6/http";
import { check, sleep } from "k6";

const BASE = __ENV.BASE_URL || "http://localhost:3000";
const TOKEN = __ENV.TOKEN || "";
const SPACE = __ENV.SPACE || "eng";
const Q = __ENV.QUERY || "온보딩";

export const options = {
  stages: [
    { duration: "30s", target: 20 },
    { duration: "1m", target: 20 },
    { duration: "10s", target: 0 },
  ],
  thresholds: { http_req_duration: ["p(95)<800"] },
};

const auth = { headers: { Authorization: `Bearer ${TOKEN}` } };

export default function () {
  const s = http.get(`${BASE}/api/search?q=${encodeURIComponent(Q)}`, auth);
  check(s, { "search 200": (r) => r.status === 200 });
  sleep(1);
}
```

- [ ] **Step 3: runaway-429.js 작성**

`deploy/loadtest/runaway-429.js`:

```js
// 폭주 루프: 단일 토큰으로 대량 요청 → 429가 발동하는지 확인한다.
// 실행: k6 run -e BASE_URL=... -e TOKEN=swk_... deploy/loadtest/runaway-429.js
import http from "k6/http";
import { check } from "k6";
import { Counter } from "k6/metrics";

const BASE = __ENV.BASE_URL || "http://localhost:3000";
const TOKEN = __ENV.TOKEN || "";
const got429 = new Counter("got_429");

export const options = {
  scenarios: {
    burst: { executor: "constant-arrival-rate", rate: 200, timeUnit: "1s", duration: "20s", preAllocatedVUs: 50 },
  },
};

export default function () {
  const res = http.get(`${BASE}/api/search?q=loadtest`, { headers: { Authorization: `Bearer ${TOKEN}` } });
  if (res.status === 429) got429.add(1);
  check(res, { "200 or 429": (r) => r.status === 200 || r.status === 429 });
}

export function handleSummary(data) {
  const c = data.metrics.got_429 ? data.metrics.got_429.values.count : 0;
  return { stdout: `\n429 응답 수: ${c} (0보다 크면 rate limit 동작)\n` };
}
```

- [ ] **Step 4: loadtest README 작성**

`deploy/loadtest/README.md`:

```markdown
# 부하 테스트 (k6)

프로덕션 스케일링(캐싱·검색튜닝·rate limit) 효과를 측정한다. Postgres·Keycloak·앱이
떠 있어야 한다(Docker/클러스터).

## 준비
- k6 설치: https://k6.io/docs/get-started/installation/
- 세션 쿠키(읽기 테스트) 또는 PAT(MCP/폭주 테스트) 발급.

## 시나리오
| 파일 | 목적 | 실행 |
|---|---|---|
| read-browse.js | 페이지 조회 → 렌더 캐시 효과 | `k6 run -e BASE_URL=... -e COOKIE="..." -e PAGE_PATH=/s/eng/온보딩 deploy/loadtest/read-browse.js` |
| mcp-search-edit.js | 검색 캐싱/튜닝 | `k6 run -e BASE_URL=... -e TOKEN=swk_... deploy/loadtest/mcp-search-edit.js` |
| runaway-429.js | rate limit 발동 | `k6 run -e BASE_URL=... -e TOKEN=swk_... deploy/loadtest/runaway-429.js` |

## 측정
각 스케일링 변경 전후로 p50/p95 latency와 throughput을 비교한다. runaway-429는 요약에
"429 응답 수"를 출력한다(0보다 크면 rate limit 정상 동작).
```

- [ ] **Step 5: JS 문법 검증**

Run: `for f in deploy/loadtest/*.js; do node --check "$f" && echo "OK $f"; done`
Expected: 각 파일 `OK`. (k6 런타임 import는 node에서 실행하지 않고 문법만 검사.)

- [ ] **Step 6: 커밋**

```bash
git add deploy/loadtest
git commit -m "test(loadtest): k6 시나리오 3종(읽기 브라우징·MCP 검색·폭주 429)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## 인프라 복구 후 검증 (Docker/클러스터 필요)

아래는 이 세션에서 Docker가 없어 미룬 검증이다. Postgres·Keycloak 복구 후 수행한다.

- **읽기 캐싱(T2)**: 페이지 조회 → 편집 → 재조회 시 최신 반영(무효화 동작). 조회 2회째가 렌더를 재계산하지 않는지(로그/latency).
- **검색(T3)**: 같은 query 반복 시 두 번째부터 캐시 히트(latency↓), 권한 다른 사용자는 서로 결과 안 보임(기존 e2e "검색 권한 격리" 통과).
- **rate limit(T1)**: `deploy/loadtest/runaway-429.js`로 429 발동 + 다른 토큰/세션 정상.
- **HPA(T5)**: 클러스터에서 `kubectl get hpa`로 app·mcp HPA 존재 및 스케일 동작.
- **부하(T6)**: 3 시나리오 실행, 각 작업 전후 p50/p95 비교.

## 자체 검토 메모

- 스펙 ①~⑤ + 부하테스트 전부 태스크로 커버(①→T2, ②→T3, ③→T1, ④→T4, ⑤→T5, 부하→T6).
- app HPA는 이미 존재 → T5는 mcp만 추가(중복 생성 방지).
- `.env.prod.example`은 저장소에 없어 커넥션 가이드는 values.yaml + deploy/README에 배치(스펙의 `.env.prod.example` 언급 대체).
