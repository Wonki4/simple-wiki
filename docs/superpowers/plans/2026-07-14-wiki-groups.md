# 스페이스 권한 자체관리(WikiGroup) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 스페이스 권한의 group 대상을 Keycloak 그룹 경로 문자열에서 위키 DB 자체 그룹(WikiGroup)으로 교체해, 그룹 변경이 재로그인 없이 즉시 반영되게 한다.

**Architecture:** `WikiGroup`/`WikiGroupMember` 테이블을 추가하고, 행위자 결정 지점 두 곳(`getSessionInfo`, `resolveApiActor`)에서 클레임 스냅샷 대신 DB 멤버십을 조회한다. `resolveSpaceRole`은 순수 함수 그대로 두고 `groups`의 의미만 바뀐다(Keycloak 경로 → WikiGroup id). 그룹 CRUD는 전역 관리자 전용 `/groups` 페이지. 전역 관리자 판정(wiki-admin/WIKI_ADMIN_GROUP)은 Keycloak 그대로.

**Tech Stack:** Next.js 15 (App Router, 서버 컴포넌트 + 서버 액션, 클라이언트 JS 없이 form), Prisma 6 + PostgreSQL, vitest(순수 함수만), Playwright(workers: 1, 순서 보장).

**Spec:** `docs/superpowers/specs/2026-07-14-wiki-groups-design.md`

## Global Constraints

- 작업 브랜치: main 최신에서 `feat/wiki-groups` 생성 (현재 브랜치 fix/empty-state-admin-cta는 PR #5로 별도 진행 중 — 건드리지 않는다).
- dev PostgreSQL은 호스트 포트 **5433** (litellm_db 충돌 회피). `docker compose up -d`로 postgres+keycloak을 띄운 뒤 마이그레이션한다. DATABASE_URL은 `.env`에 이미 있다.
- **마이그레이션 규칙:** `prisma migrate dev`가 생성한 SQL에 stray `ALTER TABLE "Page" ALTER COLUMN "searchVector" DROP DEFAULT;` 줄이 끼어들면 반드시 제거 후 적용한다(기존 프로젝트 규칙).
- UI 문구는 한국어, 기존 CSS 클래스 재사용(`btn btn-primary`, `field`, `select`, `input`, `dtable`, `section-title`, `muted`, `key`, `ConfirmSubmitButton`).
- 단위 테스트(vitest)는 순수 함수만 다룬다(기존 컨벤션 — DB 없는 테스트). DB가 필요한 검증은 e2e.
- 커밋 메시지: `feat(...)`/`fix(...)` prefix + 한국어 요약, 마지막 줄에 `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
- 전역 관리자 판정(`src/auth.ts`의 wiki-admin 역할 / WIKI_ADMIN_GROUP 그룹, `[auth]` 진단 로그)은 **절대 변경하지 않는다.**

---

### Task 0: 브랜치 준비

**Files:** 없음 (git만)

- [ ] **Step 1: main 최신화 후 브랜치 생성**

```bash
git checkout main && git pull && git checkout -b feat/wiki-groups
```

Expected: `Switched to a new branch 'feat/wiki-groups'`

---

### Task 1: 스키마 — WikiGroup / WikiGroupMember 추가

**Files:**
- Modify: `prisma/schema.prisma` (User 모델 뒤에 모델 2개 추가, User에 relation 추가)

**Interfaces:**
- Produces: Prisma 모델 `WikiGroup { id, name(unique), createdAt, members }`, `WikiGroupMember { id, groupId, userId, @@unique([groupId, userId]) }`. 이후 태스크들이 `prisma.wikiGroup`, `prisma.wikiGroupMember`로 사용한다.
- 주의: `User.groups`(클레임 스냅샷) 컬럼은 **이 태스크에서 지우지 않는다** — 아직 auth.ts/api-auth.ts가 참조 중이라 지우면 빌드가 깨진다. Task 6에서 제거.

- [ ] **Step 1: schema.prisma에 모델 추가**

`User` 모델에 relation 한 줄 추가 (`comments  Comment[]` 다음 줄):

```prisma
  groupMemberships WikiGroupMember[]
```

`Comment` 모델 아래에 신규 모델 2개 추가:

```prisma
// 위키 자체 그룹. 스페이스 권한(group 대상)의 subjectRef가 이 id를 가리킨다.
// 그룹 생성/삭제/멤버 편집은 전역 관리자 전용(/groups).
model WikiGroup {
  id        String            @id @default(cuid())
  name      String            @unique
  createdAt DateTime          @default(now())
  members   WikiGroupMember[]
}

model WikiGroupMember {
  id      String    @id @default(cuid())
  groupId String
  group   WikiGroup @relation(fields: [groupId], references: [id], onDelete: Cascade)
  userId  String
  user    User      @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@unique([groupId, userId])
  @@index([userId])
}
```

`SpacePermission.subjectRef`의 주석을 갱신:

```prisma
  // subjectType=user면 User.id(=Keycloak sub), group이면 WikiGroup.id
  subjectRef  String
```

- [ ] **Step 2: 마이그레이션 생성·적용**

```bash
docker compose up -d
npm run db:migrate -- --name add_wiki_groups
```

Expected: `Your database is now in sync with your schema.` — 생성된 `prisma/migrations/*_add_wiki_groups/migration.sql`을 열어 `CREATE TABLE "WikiGroup"`, `CREATE TABLE "WikiGroupMember"`만 있는지 확인. **stray `searchVector DROP DEFAULT` 줄이 있으면 삭제 후 `npm run db:migrate` 재실행.**

- [ ] **Step 3: 타입체크**

```bash
npx tsc --noEmit
```

Expected: 에러 0.

- [ ] **Step 4: Commit**

```bash
git add prisma/schema.prisma prisma/migrations
git commit -m "feat(schema): WikiGroup/WikiGroupMember 테이블 추가

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: 권한 판정 — 클레임 스냅샷 대신 DB 멤버십 조회

**Files:**
- Modify: `src/lib/permissions.ts` (주석만)
- Modify: `src/lib/access.ts:9-17` (`getSessionInfo`) + 헬퍼 추가
- Modify: `src/lib/api-auth.ts:45-52` (`resolveApiActor`의 토큰 분기)
- Test: `tests/permissions.test.ts`

**Interfaces:**
- Produces: `getWikiGroupIds(userId: string): Promise<string[]>` — `src/lib/access.ts`에서 export. `SessionInfo.groups`의 의미가 "내 WikiGroup id 목록"으로 바뀐다.
- Consumes: Task 1의 `prisma.wikiGroupMember`.

- [ ] **Step 1: 단위 테스트를 새 의미로 갱신 (테스트 먼저)**

`tests/permissions.test.ts`에서 그룹 식별자를 Keycloak 경로에서 WikiGroup id 표기로 교체 — 판정 로직은 동일하므로 값만 바뀐다:

```ts
import { describe, it, expect } from "vitest";
import { resolveSpaceRole, hasRole, type SessionInfo, type PermissionEntry } from "@/lib/permissions";

// groups는 위키 자체 그룹(WikiGroup)의 id 목록이다 — Keycloak 클레임이 아니다.
const alice: SessionInfo = { userId: "alice-sub", groups: ["grp-eng"], isWikiAdmin: false };
const bob: SessionInfo = { userId: "bob-sub", groups: [], isWikiAdmin: false };
const admin: SessionInfo = { userId: "admin-sub", groups: [], isWikiAdmin: true };

const perms: PermissionEntry[] = [
  { subjectType: "group", subjectRef: "grp-eng", role: "editor" },
  { subjectType: "user", subjectRef: "bob-sub", role: "viewer" },
];

describe("resolveSpaceRole", () => {
  it("wiki-admin은 항상 admin", () => {
    expect(resolveSpaceRole(admin, "restricted", [])).toBe("admin");
  });
  it("위키 그룹 id 매칭", () => {
    expect(resolveSpaceRole(alice, "restricted", perms)).toBe("editor");
  });
  it("사용자 개별 권한 매칭", () => {
    expect(resolveSpaceRole(bob, "restricted", perms)).toBe("viewer");
  });
  it("restricted + 권한 없음 → null", () => {
    expect(resolveSpaceRole(bob, "restricted", [])).toBeNull();
  });
  it("organization + 권한 없음 → viewer", () => {
    expect(resolveSpaceRole(bob, "organization", [])).toBe("viewer");
  });
  it("여러 권한 중 가장 높은 역할", () => {
    const multi: PermissionEntry[] = [
      { subjectType: "group", subjectRef: "grp-eng", role: "viewer" },
      { subjectType: "user", subjectRef: "alice-sub", role: "admin" },
    ];
    expect(resolveSpaceRole(alice, "restricted", multi)).toBe("admin");
  });
});

describe("hasRole", () => {
  it("상위 역할은 하위 권한을 포함한다", () => {
    expect(hasRole("admin", "viewer")).toBe(true);
    expect(hasRole("editor", "viewer")).toBe(true);
    expect(hasRole("viewer", "editor")).toBe(false);
    expect(hasRole(null, "viewer")).toBe(false);
  });
});
```

- [ ] **Step 2: 테스트 실행 — 통과 확인**

```bash
npm test -- tests/permissions.test.ts
```

Expected: PASS (순수 함수는 값 이름과 무관 — 이 갱신은 의미 문서화다).

- [ ] **Step 3: permissions.ts 주석 갱신**

`src/lib/permissions.ts`의 `SessionInfo`를 다음으로 교체:

```ts
export interface SessionInfo {
  userId: string;
  /** 내가 속한 WikiGroup id 목록 (요청 시 DB 조회 — 클레임 스냅샷 아님) */
  groups: string[];
  isWikiAdmin: boolean;
}
```

`PermissionEntry`의 `subjectRef`에 주석 추가:

```ts
export interface PermissionEntry {
  subjectType: "user" | "group";
  /** user면 User.id(=Keycloak sub), group이면 WikiGroup.id */
  subjectRef: string;
  role: SpaceRole;
}
```

- [ ] **Step 4: access.ts — 헬퍼 추가 + getSessionInfo 교체**

`src/lib/access.ts`의 `getSessionInfo`를 다음으로 교체하고 그 위에 헬퍼를 추가:

```ts
// 요청 시점의 위키 그룹 멤버십 조회. 세션/토큰의 클레임 스냅샷 대신 이 값으로
// 스페이스 권한을 판정하므로 그룹 변경이 재로그인 없이 즉시 반영된다.
export async function getWikiGroupIds(userId: string): Promise<string[]> {
  const rows = await prisma.wikiGroupMember.findMany({
    where: { userId },
    select: { groupId: true },
  });
  return rows.map((r) => r.groupId);
}

export async function getSessionInfo(): Promise<SessionInfo | null> {
  const session = await auth();
  if (!session?.user?.id) return null;
  return {
    userId: session.user.id,
    groups: await getWikiGroupIds(session.user.id),
    isWikiAdmin: session.isWikiAdmin ?? false,
  };
}
```

- [ ] **Step 5: api-auth.ts — 토큰 분기 교체**

`src/lib/api-auth.ts`에서 import에 `getWikiGroupIds` 추가:

```ts
import { getSessionInfo, getWikiGroupIds } from "@/lib/access";
```

`resolveApiActor`의 토큰 반환부(현재 `groups: token.user.groups`)를 교체:

```ts
      return {
        userId: token.user.id,
        groups: await getWikiGroupIds(token.user.id),
        isWikiAdmin: token.user.isWikiAdmin,
        via: "token",
        tokenName: token.name,
        tokenId: token.id,
      };
```

- [ ] **Step 6: 전체 단위 테스트 + 타입체크**

```bash
npm test && npx tsc --noEmit
```

Expected: 전부 PASS, 타입 에러 0.

- [ ] **Step 7: Commit**

```bash
git add src/lib/permissions.ts src/lib/access.ts src/lib/api-auth.ts tests/permissions.test.ts
git commit -m "feat(auth): 스페이스 권한 판정을 클레임 스냅샷에서 WikiGroup DB 조회로 교체

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: 그룹 서버 액션

**Files:**
- Create: `src/actions/groups.ts`

**Interfaces:**
- Produces: `createGroup(formData)` (필드 `name`), `deleteGroup(groupId: string)`, `addGroupMember(groupId: string, formData)` (필드 `email`), `removeGroupMember(memberId: string)`. 전부 전역 관리자 전용 — 아니면 `/denied`로 redirect.
- Consumes: `requireSession` (`src/lib/access.ts`), Task 1의 Prisma 모델.

- [ ] **Step 1: 액션 파일 작성**

`src/actions/groups.ts` 생성 (`src/actions/spaces.ts`의 createSpace 패턴을 따른다):

```ts
"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requireSession } from "@/lib/access";

async function requireWikiAdmin() {
  const session = await requireSession();
  if (!session.isWikiAdmin) redirect("/denied");
  return session;
}

export async function createGroup(formData: FormData) {
  await requireWikiAdmin();
  const name = String(formData.get("name") ?? "").trim();
  if (!name) throw new Error("그룹 이름을 입력하세요.");
  const dup = await prisma.wikiGroup.findUnique({ where: { name } });
  if (dup) throw new Error("이미 존재하는 그룹입니다.");
  await prisma.wikiGroup.create({ data: { name } });
  revalidatePath("/groups");
}

export async function deleteGroup(groupId: string) {
  await requireWikiAdmin();
  // 이 그룹을 가리키는 스페이스 권한도 같은 트랜잭션에서 삭제해 dangling ref를 막는다.
  await prisma.$transaction([
    prisma.spacePermission.deleteMany({ where: { subjectType: "group", subjectRef: groupId } }),
    prisma.wikiGroup.deleteMany({ where: { id: groupId } }),
  ]);
  revalidatePath("/groups");
  revalidatePath("/");
}

export async function addGroupMember(groupId: string, formData: FormData) {
  await requireWikiAdmin();
  const email = String(formData.get("email") ?? "").trim();
  if (!email) throw new Error("이메일을 입력하세요.");
  const user = await prisma.user.findFirst({ where: { email } });
  if (!user) throw new Error("해당 이메일의 사용자가 없습니다. 사용자가 최소 1회 로그인해야 합니다.");
  // 이미 멤버면 조용히 성공(멱등) — 시드/재실행에 안전.
  await prisma.wikiGroupMember.upsert({
    where: { groupId_userId: { groupId, userId: user.id } },
    update: {},
    create: { groupId, userId: user.id },
  });
  revalidatePath("/groups");
}

export async function removeGroupMember(memberId: string) {
  await requireWikiAdmin();
  await prisma.wikiGroupMember.deleteMany({ where: { id: memberId } });
  revalidatePath("/groups");
}
```

- [ ] **Step 2: 타입체크**

```bash
npx tsc --noEmit
```

Expected: 에러 0.

- [ ] **Step 3: Commit**

```bash
git add src/actions/groups.ts
git commit -m "feat(groups): 그룹 생성/삭제/멤버 관리 서버 액션 (전역 관리자 전용)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: /groups 관리 페이지 + 헤더 진입점

**Files:**
- Create: `src/app/groups/page.tsx`
- Modify: `src/components/Header.tsx:24-30` (userbar에 관리자 전용 링크)

**Interfaces:**
- Consumes: Task 3의 액션 4종, `requireSession`, `ConfirmSubmitButton` (`src/components/ConfirmSubmitButton`).
- Produces: e2e가 의존하는 UI 계약 — 그룹 생성 input `name="name"` + 버튼 텍스트 "그룹 만들기", 그룹별 `<section>`에 h2로 그룹 이름, 멤버 추가 input `name="email"` + 버튼 텍스트 "멤버 추가".

- [ ] **Step 1: 페이지 작성**

`src/app/groups/page.tsx` 생성:

```tsx
import { redirect } from "next/navigation";
import { requireSession } from "@/lib/access";
import { prisma } from "@/lib/db";
import { addGroupMember, createGroup, deleteGroup, removeGroupMember } from "@/actions/groups";
import { ConfirmSubmitButton } from "@/components/ConfirmSubmitButton";

export default async function GroupsPage() {
  const session = await requireSession();
  if (!session.isWikiAdmin) redirect("/denied");

  const groups = await prisma.wikiGroup.findMany({
    orderBy: { name: "asc" },
    include: { members: { include: { user: true }, orderBy: { user: { name: "asc" } } } },
  });
  // 그룹별로 연결된 스페이스 권한 수 — 삭제 경고에 쓴다.
  const linkRows = await prisma.spacePermission.groupBy({
    by: ["subjectRef"],
    where: { subjectType: "group" },
    _count: true,
  });
  const linkCount = new Map(linkRows.map((r) => [r.subjectRef, r._count]));

  return (
    <main className="py-10">
      <p className="eyebrow">admin · groups</p>
      <h1 className="page-title mt-1">그룹 관리</h1>
      <p className="muted mt-2 text-sm">
        스페이스 권한에 연결하는 위키 그룹입니다. 멤버 변경은 재로그인 없이 즉시 반영됩니다.
      </p>

      <form action={createGroup} className="mt-6 flex items-end gap-3">
        <label className="field min-w-[16rem]">
          <span>새 그룹 이름</span>
          <input name="name" required placeholder="engineering" className="input" />
        </label>
        <button className="btn btn-primary">그룹 만들기</button>
      </form>

      {groups.length === 0 && <p className="muted mt-8">아직 그룹이 없습니다.</p>}

      {groups.map((g) => (
        <section key={g.id} className="mt-10">
          <div className="flex items-center gap-3">
            <h2 className="section-title">{g.name}</h2>
            <span className="muted text-sm">
              멤버 {g.members.length}명 · 스페이스 연결 {linkCount.get(g.id) ?? 0}건
            </span>
            <form action={deleteGroup.bind(null, g.id)} className="ml-auto">
              <ConfirmSubmitButton
                message={`"${g.name}" 그룹을 삭제할까요? 연결된 스페이스 권한 ${linkCount.get(g.id) ?? 0}건도 함께 삭제됩니다.`}
                className="btn btn-danger btn-sm"
              >
                그룹 삭제
              </ConfirmSubmitButton>
            </form>
          </div>

          <div className="mt-3 overflow-x-auto">
            <table className="dtable">
              <thead>
                <tr>
                  <th>이름</th>
                  <th>이메일</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {g.members.map((m) => (
                  <tr key={m.id}>
                    <td>{m.user.name}</td>
                    <td><span className="key">{m.user.email}</span></td>
                    <td className="text-right">
                      <form action={removeGroupMember.bind(null, m.id)}>
                        <ConfirmSubmitButton
                          message={`"${m.user.name}"을(를) ${g.name} 그룹에서 제거할까요?`}
                          className="btn btn-danger btn-sm"
                        >
                          제거
                        </ConfirmSubmitButton>
                      </form>
                    </td>
                  </tr>
                ))}
                {g.members.length === 0 && (
                  <tr>
                    <td colSpan={3} className="muted">멤버가 없습니다.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <form action={addGroupMember.bind(null, g.id)} className="mt-4 flex items-end gap-3">
            <label className="field min-w-[16rem]">
              <span>멤버 추가 (이메일 — 로그인 이력이 있어야 합니다)</span>
              <input name="email" type="email" required placeholder="alice@example.com" className="input" />
            </label>
            <button className="btn btn-primary btn-sm">멤버 추가</button>
          </form>
        </section>
      ))}
    </main>
  );
}
```

- [ ] **Step 2: 헤더에 관리자 전용 링크 추가**

`src/components/Header.tsx`의 userbar에서 `토큰` 링크 앞에 추가 (`session.isWikiAdmin`은 next-auth Session에 이미 선언돼 있다):

```tsx
            {session.isWikiAdmin && (
              <Link href="/groups" className="userbar__link">
                그룹
              </Link>
            )}
```

- [ ] **Step 3: 타입체크 + 수동 확인**

```bash
npx tsc --noEmit
```

Expected: 에러 0. (수동 확인은 Task 7에서 시드 갱신 후 e2e로 대체 — dev 서버 확인은 선택.)

- [ ] **Step 4: Commit**

```bash
git add src/app/groups/page.tsx src/components/Header.tsx
git commit -m "feat(groups): /groups 그룹 관리 페이지와 헤더 진입점 (전역 관리자 전용)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: 스페이스 설정 — 그룹 드롭다운·이름 표시·검증 교체

**Files:**
- Modify: `src/actions/spaces.ts:37-60` (`addSpacePermission` 제거 → 액션 2개로 분리)
- Modify: `src/app/s/[spaceKey]/settings/page.tsx`

**Interfaces:**
- Produces: `addGroupPermission(spaceKey, formData)` (필드 `groupId`, `role`), `addUserPermission(spaceKey, formData)` (필드 `email`, `role`). e2e가 의존하는 UI 계약 — 그룹 폼 `select[name="groupId"]`, 사용자 폼 `input[name="email"]`, 각 폼 안의 `select[name="role"]`.
- Consumes: Task 1의 `prisma.wikiGroup`.

- [ ] **Step 1: 액션 교체**

`src/actions/spaces.ts`에서 `addSpacePermission` 전체(37-60행)를 다음 두 액션으로 교체:

```ts
function parseRole(v: FormDataEntryValue | null) {
  const s = String(v ?? "viewer");
  return s === "admin" ? "admin" : s === "editor" ? "editor" : "viewer";
}

export async function addGroupPermission(spaceKey: string, formData: FormData) {
  const { space } = await requireSpaceRole(spaceKey, "admin");
  const groupId = String(formData.get("groupId") ?? "");
  const role = parseRole(formData.get("role"));
  const group = await prisma.wikiGroup.findUnique({ where: { id: groupId } });
  if (!group) throw new Error("존재하지 않는 그룹입니다.");

  await prisma.spacePermission.upsert({
    where: { spaceId_subjectType_subjectRef: { spaceId: space.id, subjectType: "group", subjectRef: group.id } },
    update: { role },
    create: { spaceId: space.id, subjectType: "group", subjectRef: group.id, role },
  });
  revalidatePath(`/s/${spaceKey}/settings`);
}

export async function addUserPermission(spaceKey: string, formData: FormData) {
  const { space } = await requireSpaceRole(spaceKey, "admin");
  const email = String(formData.get("email") ?? "").trim();
  const role = parseRole(formData.get("role"));
  if (!email) throw new Error("이메일을 입력하세요.");
  const user = await prisma.user.findFirst({ where: { email } });
  if (!user) throw new Error("해당 이메일의 사용자가 없습니다. 사용자가 최소 1회 로그인해야 합니다.");

  await prisma.spacePermission.upsert({
    where: { spaceId_subjectType_subjectRef: { spaceId: space.id, subjectType: "user", subjectRef: user.id } },
    update: { role },
    create: { spaceId: space.id, subjectType: "user", subjectRef: user.id, role },
  });
  revalidatePath(`/s/${spaceKey}/settings`);
}
```

- [ ] **Step 2: 설정 페이지 갱신**

`src/app/s/[spaceKey]/settings/page.tsx`:

import 교체:

```tsx
import { addGroupPermission, addUserPermission, deleteSpace, removeSpacePermission, updateSpaceVisibility } from "@/actions/spaces";
```

데이터 준비부(10-12행)를 다음으로 교체:

```tsx
  const userIds = space.permissions.filter((p) => p.subjectType === "user").map((p) => p.subjectRef);
  const users = await prisma.user.findMany({ where: { id: { in: userIds } } });
  const userLabel = new Map(users.map((u) => [u.id, `${u.name} <${u.email}>`]));
  const allGroups = await prisma.wikiGroup.findMany({ orderBy: { name: "asc" } });
  const groupLabel = new Map(allGroups.map((g) => [g.id, g.name]));

  const subjectLabel = (p: { subjectType: string; subjectRef: string }) =>
    p.subjectType === "user"
      ? (userLabel.get(p.subjectRef) ?? p.subjectRef)
      : (groupLabel.get(p.subjectRef) ?? p.subjectRef);
```

권한 테이블의 대상 셀(48행)과 삭제 확인 메시지(55행)에서 기존 삼항식을 `subjectLabel(p)`로 교체:

```tsx
                  <td>
                    <span className="key">{subjectLabel(p)}</span>
                  </td>
```

```tsx
                        message={`"${subjectLabel(p)}"의 ${p.role} 권한을 삭제할까요?`}
```

기존 추가 폼(73-94행, `addSpacePermission` form 전체)을 폼 2개로 교체:

```tsx
        <form action={addGroupPermission.bind(null, spaceKey)} className="mt-5 flex flex-wrap items-end gap-3">
          <label className="field min-w-[16rem]">
            <span>그룹</span>
            <select name="groupId" required className="select" disabled={allGroups.length === 0}>
              {allGroups.map((g) => (
                <option key={g.id} value={g.id}>{g.name}</option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>역할</span>
            <select name="role" className="select w-auto">
              <option value="viewer">viewer</option>
              <option value="editor">editor</option>
              <option value="admin">admin</option>
            </select>
          </label>
          <button className="btn btn-primary" disabled={allGroups.length === 0}>그룹 권한 추가</button>
          {allGroups.length === 0 && (
            <span className="muted text-sm">그룹이 없습니다. 전역 관리자가 그룹 관리에서 먼저 만들어야 합니다.</span>
          )}
        </form>

        <form action={addUserPermission.bind(null, spaceKey)} className="mt-3 flex flex-wrap items-end gap-3">
          <label className="field min-w-[16rem] flex-1">
            <span>사용자 (이메일)</span>
            <input name="email" type="email" required placeholder="alice@example.com" className="input" />
          </label>
          <label className="field">
            <span>역할</span>
            <select name="role" className="select w-auto">
              <option value="viewer">viewer</option>
              <option value="editor">editor</option>
              <option value="admin">admin</option>
            </select>
          </label>
          <button className="btn btn-primary">사용자 권한 추가</button>
        </form>
```

- [ ] **Step 3: 잔여 참조 확인 + 타입체크**

```bash
grep -rn "addSpacePermission" src/ && echo "FOUND — 교체 누락" || echo "OK"
npx tsc --noEmit
```

Expected: `OK`, 타입 에러 0.

- [ ] **Step 4: Commit**

```bash
git add src/actions/spaces.ts "src/app/s/[spaceKey]/settings/page.tsx"
git commit -m "feat(spaces): 스페이스 권한의 그룹 대상을 자유 텍스트에서 WikiGroup 드롭다운으로 교체

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 6: auth 정리 — groups 클레임 전파 제거 + User.groups 컬럼 drop

**Files:**
- Modify: `src/auth.ts:37,53-56,62` (token.groups/session.groups/upsert의 groups 제거)
- Modify: `src/types/next-auth.d.ts` (Session.groups, JWT.groups 제거)
- Modify: `prisma/schema.prisma` (User.groups 제거) + 마이그레이션

**Interfaces:**
- Consumes: Task 2가 끝난 상태(아무도 `session.groups`/`User.groups`를 읽지 않음)여야 한다.
- 주의: `auth.ts`의 지역변수 `const groups = p.groups ?? []`와 WIKI_ADMIN_GROUP 판정, `[auth]` 로그는 **유지** — 관리자 판정은 계속 Keycloak 클레임 기준이다.

- [ ] **Step 1: auth.ts 정리**

`src/auth.ts`에서:

1. `token.groups = p.groups ?? [];` 줄(37행) 삭제. (`const groups = p.groups ?? [];`와 그 아래 WIKI_ADMIN_GROUP 판정·로그는 그대로 둔다.)
2. upsert(52-56행)에서 `groups` 필드 제거:

```ts
        await prisma.user.upsert({
          where: { id: p.sub },
          update: { email: p.email ?? "", name, isWikiAdmin },
          create: { id: p.sub, email: p.email ?? "", name, isWikiAdmin },
        });
```

3. upsert 위의 주석을 갱신: `// 프로필과 관리자 판정 스냅샷을 User에 저장 — 스페이스 권한은 WikiGroup(DB)에서 판정한다.`
4. session 콜백에서 `session.groups = (token.groups as string[]) ?? [];` 줄(62행) 삭제.
5. 파일 상단(8-10행) 세션 수명 주석 갱신:

```ts
  // 관리자 판정(realm_roles/WIKI_ADMIN_GROUP)은 로그인 시점에만 갱신되므로 세션을 짧게 유지해
  // Keycloak에서 회수된 관리자 권한이 최대 8시간 내에 만료되도록 한다.
  // 스페이스 권한은 WikiGroup(DB) 기준이라 세션 수명과 무관하게 즉시 반영된다.
```

- [ ] **Step 2: 타입 선언 정리**

`src/types/next-auth.d.ts`를 다음으로 교체:

```ts
import "next-auth";
import "next-auth/jwt";

declare module "next-auth" {
  interface Session {
    isWikiAdmin: boolean;
    user: { id: string; name?: string | null; email?: string | null };
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    realmRoles?: string[];
    isWikiAdmin?: boolean;
  }
}
```

- [ ] **Step 3: User.groups 컬럼 제거 + 마이그레이션**

`prisma/schema.prisma`의 `User`에서 `groups String[] @default([])` 줄과 그 위 스냅샷 주석 2줄(20-22행)을 삭제하고, `isWikiAdmin` 위에 한 줄 주석으로 대체:

```prisma
  // 로그인 시점의 관리자 판정 스냅샷. API 토큰 요청이 이 값으로 전역 관리자를 판정한다.
  isWikiAdmin Boolean  @default(false)
```

```bash
npm run db:migrate -- --name remove_user_groups_claim_snapshot
```

Expected: 생성된 SQL이 `ALTER TABLE "User" DROP COLUMN "groups";` 하나인지 확인. **stray `searchVector DROP DEFAULT` 줄이 있으면 삭제 후 재실행.**

- [ ] **Step 4: 잔여 참조 확인 + 검증**

```bash
grep -rn "session\.groups\|user\.groups\|token\.groups" src/ mcp-server/src/ && echo "FOUND — 정리 누락" || echo "OK"
npm test && npx tsc --noEmit
```

Expected: `OK`, 전부 PASS, 타입 에러 0.

- [ ] **Step 5: Commit**

```bash
git add src/auth.ts src/types/next-auth.d.ts prisma/schema.prisma prisma/migrations
git commit -m "feat(auth): groups 클레임 전파/스냅샷 제거 — 스페이스 권한은 WikiGroup만 사용

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 7: 시드 + e2e 갱신

**Files:**
- Modify: `prisma/seed.ts`
- Modify: `e2e/wiki.spec.ts:1-64` (그룹 셋업 테스트 추가, wiki-admin 테스트 수정)

**Interfaces:**
- Consumes: Task 4의 /groups UI 계약(`input[name="name"]`, "그룹 만들기", `input[name="email"]`, "멤버 추가"), Task 5의 설정 폼 계약(`select[name="groupId"]`).
- Produces: 시드 후 상태 — `engineering` WikiGroup(멤버 없음)이 `eng` 스페이스에 editor로 연결됨. e2e 첫 테스트가 alice를 이 그룹에 넣는다.

- [ ] **Step 1: seed.ts 갱신**

`prisma/seed.ts`의 `main()`을 다음으로 교체:

```ts
async function main() {
  await prisma.space.upsert({
    where: { key: "notice" },
    update: {},
    create: { key: "notice", name: "공지사항", description: "전사 공지", visibility: "organization" },
  });

  const eng = await prisma.space.upsert({
    where: { key: "eng" },
    update: {},
    create: { key: "eng", name: "엔지니어링", description: "엔지니어링 팀 위키", visibility: "restricted" },
  });

  // 위키 자체 그룹. 멤버는 사용자가 최소 1회 로그인한 뒤 /groups에서 추가한다(User.id = Keycloak sub).
  const engGroup = await prisma.wikiGroup.upsert({
    where: { name: "engineering" },
    update: {},
    create: { name: "engineering" },
  });

  // 구 시드의 Keycloak 경로 기반 권한 잔재 제거(있다면).
  await prisma.spacePermission.deleteMany({ where: { subjectType: "group", subjectRef: "/engineering" } });

  await prisma.spacePermission.upsert({
    where: {
      spaceId_subjectType_subjectRef: { spaceId: eng.id, subjectType: "group", subjectRef: engGroup.id },
    },
    update: { role: "editor" },
    create: { spaceId: eng.id, subjectType: "group", subjectRef: engGroup.id, role: "editor" },
  });

  console.log("seed 완료: notice(organization), eng(restricted, engineering 그룹=editor — 멤버는 /groups에서 추가)");
}
```

- [ ] **Step 2: 시드 실행**

```bash
npm run db:seed
```

Expected: `seed 완료: ...` 출력.

- [ ] **Step 3: e2e — 그룹 셋업 테스트를 파일 첫 테스트로 추가**

`e2e/wiki.spec.ts`에서 기존 첫 테스트(`alice: 페이지 생성...`, 6행) **앞에** 추가. workers: 1 + 단일 파일이라 순서가 보장되며, 이후의 모든 alice 시나리오가 이 테스트의 멤버십에 의존한다:

```ts
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
```

- [ ] **Step 4: e2e — wiki-admin 권한 부여 시나리오를 드롭다운 방식으로 수정**

`test("wiki-admin: 스페이스 생성과 권한 부여", ...)`에서 설정 화면 조작부(기존 `/hr` 자유 텍스트 입력, 57-62행)를 교체:

```ts
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
```

(이 테스트 앞부분의 스페이스 생성 조작과 마지막이 아니라면 기존 코드는 그대로 둔다.)

- [ ] **Step 5: Commit**

```bash
git add prisma/seed.ts e2e/wiki.spec.ts
git commit -m "test(e2e): 시드·e2e를 WikiGroup 기반으로 전환 — 즉시 반영 시나리오 추가

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 8: 전체 검증

**Files:** 없음 (검증만)

- [ ] **Step 1: 단위 테스트 + 타입체크**

```bash
npm test && npx tsc --noEmit
```

Expected: 전부 PASS, 타입 에러 0.

- [ ] **Step 2: e2e 준비 — DB 리셋 + 시드**

e2e는 깨끗한 DB를 전제한다(스페이스 `e2e-docs`, 그룹 `hr` 생성 등 비멱등 시나리오):

```bash
docker compose up -d
npx prisma migrate reset --force
npm run db:seed
```

Expected: reset 후 시드 완료 메시지.

- [ ] **Step 3: e2e 실행**

```bash
npm run e2e
```

Expected: 전 테스트 PASS. 실패 시 스크린샷/트레이스(`test-results/`)로 원인 확인 후 수정 — 특히 새 그룹 셋업 테스트가 첫 번째로 실행되는지 확인.

- [ ] **Step 4: 수동 스모크 (선택이지만 권장)**

```bash
npm run dev
```

1. wiki-admin으로 로그인 → 헤더에 "그룹" 링크 → /groups에서 그룹 생성/삭제.
2. 스페이스 설정에서 그룹 드롭다운으로 권한 부여, 권한 목록에 그룹 **이름**이 보이는지.
3. alice로 로그인(일반 사용자) → /groups 직접 접근 시 /denied.

- [ ] **Step 5: PR 생성**

```bash
git push -u origin feat/wiki-groups
gh pr create --title "feat: 스페이스 권한 자체관리 — WikiGroup 도입" --body "$(cat <<'EOF'
## Summary
- 스페이스 권한의 group 대상을 Keycloak 그룹 경로 → 위키 DB 자체 그룹(WikiGroup)으로 교체
- 그룹 변경이 재로그인 없이 즉시 반영 (요청 시 DB 멤버십 조회)
- /groups 그룹 관리 페이지 (전역 관리자 전용), 스페이스 설정은 그룹 드롭다운으로
- 전역 관리자 판정(wiki-admin/WIKI_ADMIN_GROUP)은 기존 Keycloak 방식 유지
- User.groups 클레임 스냅샷 제거 — Keycloak groups 매퍼는 이제 관리자 판정에만 필요

설계 문서: docs/superpowers/specs/2026-07-14-wiki-groups-design.md

## Test plan
- [ ] npm test / tsc --noEmit
- [ ] e2e: 그룹 즉시 반영 시나리오, bob restricted 404 유지, wiki-admin 드롭다운 권한 부여

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Self-Review 결과

- **스펙 커버리지:** 데이터 모델(Task 1), 판정 교체 + MCP/PAT 경로(Task 2 — 두 깔때기 모두), 그룹 관리 UI(Task 3-4), 스페이스 설정 UI(Task 5), auth 정리 + 컬럼 drop(Task 6), 시드/e2e(Task 7). 스펙의 "그룹 삭제 시 SpacePermission 동반 삭제"는 Task 3 `deleteGroup` 트랜잭션 + Task 4 삭제 확인 문구로 구현.
- **타입 일관성:** `getWikiGroupIds`(Task 2 정의 → Task 2에서 api-auth가 소비), `createGroup`/`deleteGroup`/`addGroupMember`/`removeGroupMember`(Task 3 → Task 4), `addGroupPermission`/`addUserPermission`(Task 5 정의·소비), e2e 셀렉터 계약(Task 4·5 → Task 7) 일치 확인.
- **의도적 순서:** `User.groups` drop을 Task 6으로 미뤄 모든 커밋이 컴파일 그린 유지. 마이그레이션 2회는 의도된 것.
