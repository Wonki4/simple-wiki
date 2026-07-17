# 권한 추가 UX 수정 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 권한/멤버 추가에서 Keycloak 아이디 검색을 지원하고, 예상 실패가 크래시 대신 배너+서버 로그로 나타나게 한다.

**Architecture:** `User.username`(preferred_username) 컬럼 추가 → 조회 헬퍼(이메일→아이디 순) → 액션 4곳의 expected-failure throw를 `?error=` redirect로 전환, 페이지 2곳이 배너 렌더. 서버 컴포넌트 구조 유지(클라이언트 JS 추가 없음).

**Tech Stack:** Next.js 15 서버 액션/컴포넌트, Prisma 6, Playwright.

**Spec:** `docs/superpowers/specs/2026-07-16-permission-add-ux-design.md`

## Global Constraints

- 브랜치 `fix/permission-add-ux` (생성·체크아웃됨, main=ce77741 기준).
- dev PostgreSQL :5433 (docker 실행 중), 타입체크 `npx tsc --noEmit`, **`npm run build` 금지**.
- 마이그레이션: additive라 `npm run db:migrate -- --name <이름>` 가능. 생성 SQL에서 stray `ALTER TABLE "Page" ALTER COLUMN "searchVector" DROP DEFAULT;` 줄 확인·제거. 만약 non-interactive 거부되면: `prisma migrate diff --script`로 SQL 확인 → 수동 마이그레이션 폴더 → `prisma migrate deploy` (이 저장소에서 검증된 우회).
- e2e 전체 실행은 DB 리셋 필요 — **Prisma AI 안전장치 때문에 컨트롤러가 사용자 동의 받아 수행**. 서브에이전트는 reset 시도 금지.
- 사용자 폼의 input `name="email"`은 유지한다 (라벨만 "이메일 또는 아이디"로) — e2e 셀렉터·최소 diff.
- 예상 밖 에러(DB 장애 등)는 여전히 throw — expected-failure만 redirect 전환.
- UI 문구 한국어. 커밋: prefix+한국어+`Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.

---

### Task 1: User.username 컬럼 + 로그인 저장

**Files:**
- Modify: `prisma/schema.prisma` (User 모델)
- Modify: `src/auth.ts` (upsert)

**Interfaces:**
- Produces: `User.username: string | null` (unique). Task 2의 `findUnique({ where: { username } })`가 의존.

- [ ] **Step 1: 스키마 — User에 username 추가**

`prisma/schema.prisma`의 `User` 모델에서 `name      String   @default("")` 다음 줄에 추가:

```prisma
  // Keycloak 로그인 아이디(preferred_username). 권한 부여 시 이메일 대신 검색하는 용도.
  // 이 컬럼 도입 전 마지막 로그인 사용자는 다음 로그인까지 null이다.
  username  String?  @unique
```

- [ ] **Step 2: 마이그레이션**

```bash
npm run db:migrate -- --name add_user_username
```

Expected: `ALTER TABLE "User" ADD COLUMN "username" TEXT;` + `CREATE UNIQUE INDEX "User_username_key"` 만 포함. stray searchVector 줄 있으면 제거 후 재적용(Global Constraints 참고).

- [ ] **Step 3: auth.ts upsert에 username 저장**

`src/auth.ts`의 `prisma.user.upsert`를 다음으로 교체:

```ts
        await prisma.user.upsert({
          where: { id: p.sub },
          update: { email: p.email ?? "", name, username: p.preferred_username ?? null, isWikiAdmin },
          create: { id: p.sub, email: p.email ?? "", name, username: p.preferred_username ?? null, isWikiAdmin },
        });
```

- [ ] **Step 4: 검증**

```bash
npm test && npx tsc --noEmit
```

Expected: 52/52 PASS, 에러 0.

- [ ] **Step 5: Commit**

```bash
git add prisma/schema.prisma prisma/migrations src/auth.ts
git commit -m "feat(auth): User.username(Keycloak preferred_username) 저장

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: 조회 헬퍼 + 액션 에러 전환 + 배너

**Files:**
- Create: `src/lib/users.ts`
- Modify: `src/actions/spaces.ts` (`addGroupPermission`, `addUserPermission`)
- Modify: `src/actions/groups.ts` (`createGroup`, `addGroupMember`)
- Modify: `src/app/s/[spaceKey]/settings/page.tsx` (searchParams+배너+라벨)
- Modify: `src/app/groups/page.tsx` (searchParams+배너+라벨)

**Interfaces:**
- Consumes: Task 1의 `User.username`.
- Produces: `findUserByEmailOrUsername(value: string)` (`src/lib/users.ts`). 에러 배너 계약 — `.notice.notice-warn[role="alert"]`에 에러 메시지 (Task 3 e2e가 의존).

- [ ] **Step 1: src/lib/users.ts 생성**

```ts
import { prisma } from "@/lib/db";

// 권한 부여 대상 검색: 이메일 정확 일치 우선, 없으면 Keycloak 로그인 아이디(username).
// username은 unique라 모호성이 없다. 컬럼 도입 전 로그인한 사용자는 다음 로그인까지 username이 null이다.
export async function findUserByEmailOrUsername(value: string) {
  return (
    (await prisma.user.findFirst({ where: { email: value } })) ??
    (await prisma.user.findUnique({ where: { username: value } }))
  );
}
```

- [ ] **Step 2: spaces.ts — 두 액션 전환**

import 추가: `import { findUserByEmailOrUsername } from "@/lib/users";`

`addGroupPermission`을 다음으로 교체:

```ts
export async function addGroupPermission(spaceKey: string, formData: FormData) {
  const { space } = await requireSpaceRole(spaceKey, "admin");
  const groupId = String(formData.get("groupId") ?? "");
  const role = parseRole(formData.get("role"));
  const group = await prisma.wikiGroup.findUnique({ where: { id: groupId } });
  if (!group) {
    // 드롭다운 우회/경합 케이스 — 크래시 대신 배너로 안내하고 서버 로그를 남긴다.
    console.warn(`[perm] 그룹 권한 추가 실패 — 존재하지 않는 그룹 (space=${spaceKey}, groupId=${groupId})`);
    redirect(`/s/${spaceKey}/settings?error=${encodeURIComponent("존재하지 않는 그룹입니다.")}`);
  }

  await prisma.spacePermission.upsert({
    where: { spaceId_subjectType_subjectRef: { spaceId: space.id, subjectType: "group", subjectRef: group.id } },
    update: { role },
    create: { spaceId: space.id, subjectType: "group", subjectRef: group.id, role },
  });
  revalidatePath(`/s/${spaceKey}/settings`);
  // 성공 시에도 쿼리 없는 경로로 — 이전 에러 배너가 URL에 남지 않게.
  redirect(`/s/${spaceKey}/settings`);
}
```

`addUserPermission`을 다음으로 교체:

```ts
export async function addUserPermission(spaceKey: string, formData: FormData) {
  const { space } = await requireSpaceRole(spaceKey, "admin");
  const value = String(formData.get("email") ?? "").trim();
  const role = parseRole(formData.get("role"));
  if (!value) redirect(`/s/${spaceKey}/settings?error=${encodeURIComponent("이메일 또는 아이디를 입력하세요.")}`);
  const user = await findUserByEmailOrUsername(value);
  if (!user) {
    console.warn(`[perm] 사용자 권한 추가 실패 — 사용자 없음 (space=${spaceKey}, 입력=${value})`);
    redirect(
      `/s/${spaceKey}/settings?error=${encodeURIComponent(
        "해당 이메일 또는 아이디의 사용자가 없습니다. 사용자가 최소 1회 로그인해야 하며, 아이디 검색은 다음 로그인부터 가능합니다.",
      )}`,
    );
  }

  await prisma.spacePermission.upsert({
    where: { spaceId_subjectType_subjectRef: { spaceId: space.id, subjectType: "user", subjectRef: user.id } },
    update: { role },
    create: { spaceId: space.id, subjectType: "user", subjectRef: user.id, role },
  });
  revalidatePath(`/s/${spaceKey}/settings`);
  redirect(`/s/${spaceKey}/settings`);
}
```

- [ ] **Step 3: groups.ts — 두 액션 전환**

`createGroup`을 다음으로 교체:

```ts
export async function createGroup(formData: FormData) {
  await requireWikiAdmin();
  const name = String(formData.get("name") ?? "").trim();
  if (!name) redirect(`/groups?error=${encodeURIComponent("그룹 이름을 입력하세요.")}`);
  const dup = await prisma.wikiGroup.findUnique({ where: { name } });
  if (dup) {
    console.warn(`[perm] 그룹 생성 실패 — 중복 이름 (name=${name})`);
    redirect(`/groups?error=${encodeURIComponent("이미 존재하는 그룹입니다.")}`);
  }
  await prisma.wikiGroup.create({ data: { name } });
  revalidatePath("/groups");
  redirect("/groups");
}
```

`addGroupMember`를 다음으로 교체 (import 추가: `import { findUserByEmailOrUsername } from "@/lib/users";`):

```ts
export async function addGroupMember(groupId: string, formData: FormData) {
  await requireWikiAdmin();
  const value = String(formData.get("email") ?? "").trim();
  if (!value) redirect(`/groups?error=${encodeURIComponent("이메일 또는 아이디를 입력하세요.")}`);
  const user = await findUserByEmailOrUsername(value);
  if (!user) {
    console.warn(`[perm] 그룹 멤버 추가 실패 — 사용자 없음 (groupId=${groupId}, 입력=${value})`);
    redirect(
      `/groups?error=${encodeURIComponent(
        "해당 이메일 또는 아이디의 사용자가 없습니다. 사용자가 최소 1회 로그인해야 하며, 아이디 검색은 다음 로그인부터 가능합니다.",
      )}`,
    );
  }
  // 이미 멤버면 조용히 성공(멱등) — 시드/재실행에 안전.
  await prisma.wikiGroupMember.upsert({
    where: { groupId_userId: { groupId, userId: user.id } },
    update: {},
    create: { groupId, userId: user.id },
  });
  revalidatePath("/groups");
  redirect("/groups");
}
```

- [ ] **Step 4: 설정 페이지 — searchParams + 배너 + 라벨**

`src/app/s/[spaceKey]/settings/page.tsx` 시그니처 교체:

```tsx
export default async function SpaceSettingsPage({
  params,
  searchParams,
}: {
  params: Promise<{ spaceKey: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { spaceKey } = await params;
  const { error } = await searchParams;
```

`<h1 className="page-title mt-1">{space.name} 설정</h1>` 바로 다음에:

```tsx
      {error && (
        <div className="notice notice-warn mt-4" role="alert">
          {error}
        </div>
      )}
```

사용자 폼 라벨/입력 교체: `<span>사용자 (이메일)</span>` → `<span>사용자 (이메일 또는 아이디)</span>`, `<input name="email" type="email" ...>` → `<input name="email" type="text" required placeholder="alice@example.com 또는 alice" className="input" />`.

- [ ] **Step 5: /groups 페이지 — searchParams + 배너 + 라벨**

`src/app/groups/page.tsx` 시그니처에 `searchParams: Promise<{ error?: string }>` 추가(설정 페이지와 같은 패턴), `<h1 className="page-title mt-1">그룹 관리</h1>` 아래 안내 문단 다음에 같은 배너 블록 추가. 멤버 추가 폼: `<span>멤버 추가 (이메일 — 로그인 이력이 있어야 합니다)</span>` → `<span>멤버 추가 (이메일 또는 아이디 — 로그인 이력이 있어야 합니다)</span>`, input `type="email"` → `type="text"`.

- [ ] **Step 6: 검증**

```bash
grep -n "throw new Error" src/actions/spaces.ts src/actions/groups.ts
npm test && npx tsc --noEmit
```

Expected: throw는 두 파일에서 0건(deleteSpace의 P2025 재throw `throw e`는 예외 — expected-failure 아님), 52/52 PASS, 에러 0.

- [ ] **Step 7: Commit**

```bash
git add src/lib/users.ts src/actions/spaces.ts src/actions/groups.ts "src/app/s/[spaceKey]/settings/page.tsx" src/app/groups/page.tsx
git commit -m "fix(perm): 권한/멤버 추가 실패를 크래시 대신 배너+서버 로그로, 아이디 검색 지원

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: e2e + 전체 검증 + PR

**Files:**
- Modify: `e2e/wiki.spec.ts` (wiki-admin 테스트 확장)

**Interfaces:**
- Consumes: Task 2의 배너 계약(`.notice-warn`), username 검색.

- [ ] **Step 1: wiki-admin 테스트 확장**

`test("wiki-admin: 스페이스 생성과 권한 부여", ...)`의 마지막 어서션(`getByRole("cell", { name: "hr" })`) 다음에 추가:

```ts
  // 없는 사용자는 크래시 대신 경고 배너 + 서버 로그
  const userForm = page.locator('form:has(input[name="email"])');
  await userForm.locator('input[name="email"]').fill("nobody@example.com");
  await userForm.getByRole("button", { name: "사용자 권한 추가" }).click();
  await expect(page.locator(".notice-warn").filter({ hasText: "사용자가 없습니다" })).toBeVisible();

  // Keycloak 아이디로 추가 — alice는 첫 테스트에서 로그인해 username이 채워져 있다
  await userForm.locator('input[name="email"]').fill("alice");
  await userForm.getByRole("button", { name: "사용자 권한 추가" }).click();
  await expect(page.getByRole("cell", { name: /alice@example.com/ })).toBeVisible();
```

- [ ] **Step 2: 단위 + 타입**

```bash
npm test && npx tsc --noEmit
```

- [ ] **Step 3: e2e 준비 — DB 리셋 (컨트롤러 담당, 서브에이전트는 시도 금지)**

- [ ] **Step 4: e2e 전체**

```bash
npm run e2e
```

Expected: 11/11 PASS (확장된 wiki-admin 시나리오 포함).

- [ ] **Step 5: PR**

```bash
git push -u origin fix/permission-add-ux
gh pr create --title "fix: 권한 추가 크래시 수정 — 배너 표시 + Keycloak 아이디 검색" --body "$(cat <<'EOF'
## Summary
- 권한/멤버 추가의 예상 실패(사용자 없음, 그룹 중복 등)가 프로덕션에서 일반 에러 화면으로 터지던 문제 수정 — `?error=` redirect + `.notice-warn` 배너 + `[perm]` 서버 로그
- Keycloak 로그인 아이디(preferred_username) 검색 지원: `User.username` 컬럼 추가(로그인 시 저장), 이메일→아이디 순 조회
- 기존 사용자의 아이디는 다음 로그인부터 채워짐 (그전엔 이메일로 검색)

설계: docs/superpowers/specs/2026-07-16-permission-add-ux-design.md

## Test plan
- [ ] unit 52/52 / tsc 0
- [ ] e2e 11/11 — 없는 사용자 배너, 아이디로 추가 시나리오 포함

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Self-Review 결과

- 스펙 커버리지: username 저장(Task 1), 조회 헬퍼+4곳 전환+배너 2곳+라벨(Task 2), e2e/검증/PR(Task 3). 완료.
- 타입 일관성: `findUserByEmailOrUsername`(Task 2 정의·소비), 배너 셀렉터 `.notice-warn`(Task 2 → Task 3), input `name="email"` 유지 확인.
- redirect는 `never` 반환이라 TS 내로잉으로 null 분기 이후 코드 안전. placeholder 없음.
