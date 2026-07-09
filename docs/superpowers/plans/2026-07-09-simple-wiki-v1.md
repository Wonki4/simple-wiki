# simple-wiki v1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 수십~수백 명 조직용 마크다운 위키 — Keycloak 인증, 스페이스 단위 권한, 페이지 CRUD/버전 이력/검색/첨부/위키링크.

**Architecture:** Next.js 15 (App Router) 단일 풀스택 앱. 모든 데이터 접근은 서버 측 권한 검사(`requireSpaceRole`)를 통과. PostgreSQL에 문서·이력·권한 저장(FTS 검색), Keycloak은 docker-compose + realm import JSON으로 재현 가능하게 구성.

**Tech Stack:** Next.js 15, TypeScript, Prisma 6, PostgreSQL 16, Auth.js(next-auth v5) + Keycloak OIDC, CodeMirror 6, unified(remark/rehype) + rehype-sanitize + shiki, Tailwind CSS v4, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-07-09-simple-wiki-design.md`

## Global Constraints

- Node.js 20+, 패키지 매니저는 npm.
- TypeScript strict 모드. 경로 별칭 `@/*` → `src/*`.
- 모든 인가 검사는 서버 측에서만 수행. 페이지/서버 액션은 `requireSpaceRole`, API route는 `getSessionInfo` + 명시적 상태코드. 클라이언트 상태는 신뢰하지 않는다.
- restricted 스페이스는 권한 없는 사용자에게 존재를 숨긴다(403이 아니라 404).
- UI 문구는 한국어.
- 순수 로직(권한 판정, slug, 위키링크 파서, 렌더 파이프라인)은 Vitest TDD. 라우트/UI는 Playwright e2e로 검증.
- 커밋 메시지는 conventional commits (`feat:`, `chore:`, `test:` ...).
- dev 환경 변수는 `.env` (`.env.example` 복사). Keycloak dev 시크릿 `dev-only-secret`은 로컬 전용 — 운영 배포 시 반드시 교체.

---

### Task 1: Next.js 프로젝트 스캐폴드 + Vitest

`create-next-app`은 비어있지 않은 디렉토리(LICENSE/README/docs 존재)에서 실패하므로 파일을 직접 작성한다.

**Files:**
- Create: `package.json`, `tsconfig.json`, `next.config.ts`, `postcss.config.mjs`, `vitest.config.ts`, `.gitignore`
- Create: `src/app/layout.tsx`, `src/app/page.tsx`, `src/app/globals.css`
- Test: `tests/smoke.test.ts`

**Interfaces:**
- Produces: `npm run dev|build|test` 스크립트, `@/*` 별칭. 이후 모든 태스크가 이 위에서 동작.

- [ ] **Step 1: 설정 파일 작성**

`package.json`:
```json
{
  "name": "simple-wiki",
  "private": true,
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "test": "vitest run",
    "test:watch": "vitest",
    "e2e": "playwright test",
    "db:migrate": "prisma migrate dev",
    "db:seed": "tsx prisma/seed.ts",
    "postinstall": "prisma generate || true"
  },
  "dependencies": {
    "@codemirror/lang-markdown": "^6.3.0",
    "@prisma/client": "^6.7.0",
    "@shikijs/rehype": "^3.4.0",
    "@uiw/react-codemirror": "^4.23.0",
    "next": "^15.3.0",
    "next-auth": "^5.0.0-beta.29",
    "react": "^19.1.0",
    "react-dom": "^19.1.0",
    "rehype-sanitize": "^6.0.0",
    "rehype-stringify": "^10.0.0",
    "remark-gfm": "^4.0.0",
    "remark-parse": "^11.0.0",
    "remark-rehype": "^11.1.0",
    "unified": "^11.0.0",
    "unist-util-visit": "^5.0.0"
  },
  "devDependencies": {
    "@playwright/test": "^1.52.0",
    "@tailwindcss/postcss": "^4.1.0",
    "@types/node": "^22.0.0",
    "@types/react": "^19.1.0",
    "@types/react-dom": "^19.1.0",
    "prisma": "^6.7.0",
    "tailwindcss": "^4.1.0",
    "tsx": "^4.19.0",
    "typescript": "^5.8.0",
    "vitest": "^3.1.0"
  }
}
```

`tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["dom", "dom.iterable", "esnext"],
    "allowJs": true,
    "skipLibCheck": true,
    "strict": true,
    "noEmit": true,
    "esModuleInterop": true,
    "module": "esnext",
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "jsx": "preserve",
    "incremental": true,
    "plugins": [{ "name": "next" }],
    "paths": { "@/*": ["./src/*"] }
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
  "exclude": ["node_modules"]
}
```

`next.config.ts`:
```ts
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
};

export default nextConfig;
```

`postcss.config.mjs`:
```js
export default { plugins: { "@tailwindcss/postcss": {} } };
```

`vitest.config.ts`:
```ts
import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: { environment: "node", include: ["tests/**/*.test.ts"] },
  resolve: { alias: { "@": path.resolve(__dirname, "src") } },
});
```

`.gitignore`:
```
node_modules/
.next/
.env
data/
next-env.d.ts
test-results/
playwright-report/
*.tsbuildinfo
.superpowers/
.omc/
```

- [ ] **Step 2: 앱 최소 골격 작성**

`src/app/globals.css`:
```css
@import "tailwindcss";

.wiki-link-missing {
  color: #dc2626;
}
.prose-wiki {
  max-width: 65ch;
}
.prose-wiki h1 { font-size: 1.5rem; font-weight: 700; margin: 1rem 0 0.5rem; }
.prose-wiki h2 { font-size: 1.25rem; font-weight: 700; margin: 1rem 0 0.5rem; }
.prose-wiki h3 { font-size: 1.1rem; font-weight: 600; margin: 0.75rem 0 0.5rem; }
.prose-wiki p { margin: 0.5rem 0; line-height: 1.7; }
.prose-wiki ul { list-style: disc; padding-left: 1.5rem; }
.prose-wiki ol { list-style: decimal; padding-left: 1.5rem; }
.prose-wiki a { color: #2563eb; text-decoration: underline; }
.prose-wiki pre { background: #f6f8fa; padding: 0.75rem; border-radius: 6px; overflow-x: auto; margin: 0.5rem 0; }
.prose-wiki code { font-size: 0.875em; }
.prose-wiki table { border-collapse: collapse; margin: 0.5rem 0; }
.prose-wiki th, .prose-wiki td { border: 1px solid #d1d5db; padding: 0.25rem 0.75rem; }
.prose-wiki blockquote { border-left: 3px solid #d1d5db; padding-left: 0.75rem; color: #6b7280; }
.prose-wiki img { max-width: 100%; }
```

`src/app/layout.tsx` (Task 7에서 헤더가 붙은 버전으로 교체된다):
```tsx
import "./globals.css";

export const metadata = { title: "simple-wiki" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <body className="mx-auto max-w-4xl px-4">{children}</body>
    </html>
  );
}
```

`src/app/page.tsx` (Task 8에서 스페이스 목록으로 교체된다):
```tsx
export default function Home() {
  return <main className="py-8">simple-wiki</main>;
}
```

- [ ] **Step 3: 스모크 테스트 작성**

`tests/smoke.test.ts`:
```ts
import { describe, it, expect } from "vitest";

describe("test harness", () => {
  it("runs", () => {
    expect(1 + 1).toBe(2);
  });
});
```

- [ ] **Step 4: 설치 및 검증**

Run: `npm install` (postinstall의 prisma generate는 스키마가 없어 `|| true`로 무시됨)
Run: `npm test` → Expected: PASS (1 passed)
Run: `npm run build` → Expected: 성공 (`✓ Compiled successfully`)

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "chore: Next.js 15 + TypeScript + Tailwind + Vitest 스캐폴드"
```

---

### Task 2: docker-compose (PostgreSQL + Keycloak) + realm 설정

**Files:**
- Create: `docker-compose.yml`, `keycloak/realm-export.json`, `.env.example`

**Interfaces:**
- Produces: `localhost:5433` PostgreSQL(wiki/wiki/wiki — 호스트 5432는 이 머신의 다른 프로젝트가 사용 중이라 5433으로 매핑), `localhost:8080` Keycloak.
  realm `simple-wiki`, client `simple-wiki-app`(secret `dev-only-secret`), realm 역할 `wiki-admin`,
  그룹 `/engineering` `/hr`, 테스트 유저 `wiki-admin/admin1234`(wiki-admin 역할), `alice/alice1234`(/engineering), `bob/bob1234`(그룹 없음).
  ID 토큰에 `groups`(풀 경로), `realm_roles` 클레임 포함 — Task 7의 auth 콜백이 이 클레임 이름에 의존.

- [ ] **Step 1: docker-compose.yml 작성**

```yaml
services:
  postgres:
    image: postgres:16
    environment:
      POSTGRES_USER: wiki
      POSTGRES_PASSWORD: wiki
      POSTGRES_DB: wiki
    ports:
      - "5433:5432"
    volumes:
      - pgdata:/var/lib/postgresql/data

  keycloak:
    image: quay.io/keycloak/keycloak:26.0
    command: start-dev --import-realm
    environment:
      KC_BOOTSTRAP_ADMIN_USERNAME: admin
      KC_BOOTSTRAP_ADMIN_PASSWORD: admin
    ports:
      - "8080:8080"
    volumes:
      - ./keycloak:/opt/keycloak/data/import

volumes:
  pgdata:
```

- [ ] **Step 2: keycloak/realm-export.json 작성**

```json
{
  "realm": "simple-wiki",
  "enabled": true,
  "registrationAllowed": false,
  "roles": {
    "realm": [
      { "name": "wiki-admin", "description": "위키 전역 관리자" }
    ]
  },
  "groups": [
    { "name": "engineering", "path": "/engineering" },
    { "name": "hr", "path": "/hr" }
  ],
  "clients": [
    {
      "clientId": "simple-wiki-app",
      "name": "simple-wiki",
      "enabled": true,
      "protocol": "openid-connect",
      "publicClient": false,
      "secret": "dev-only-secret",
      "redirectUris": ["http://localhost:3000/*"],
      "webOrigins": ["http://localhost:3000"],
      "standardFlowEnabled": true,
      "directAccessGrantsEnabled": false,
      "protocolMappers": [
        {
          "name": "groups",
          "protocol": "openid-connect",
          "protocolMapper": "oidc-group-membership-mapper",
          "consentRequired": false,
          "config": {
            "claim.name": "groups",
            "full.path": "true",
            "id.token.claim": "true",
            "access.token.claim": "true",
            "userinfo.token.claim": "true"
          }
        },
        {
          "name": "realm-roles",
          "protocol": "openid-connect",
          "protocolMapper": "oidc-usermodel-realm-role-mapper",
          "consentRequired": false,
          "config": {
            "claim.name": "realm_roles",
            "multivalued": "true",
            "id.token.claim": "true",
            "access.token.claim": "true",
            "userinfo.token.claim": "true"
          }
        }
      ]
    }
  ],
  "users": [
    {
      "username": "wiki-admin",
      "enabled": true,
      "email": "wiki-admin@example.com",
      "emailVerified": true,
      "firstName": "Wiki",
      "lastName": "Admin",
      "credentials": [{ "type": "password", "value": "admin1234", "temporary": false }],
      "realmRoles": ["wiki-admin"]
    },
    {
      "username": "alice",
      "enabled": true,
      "email": "alice@example.com",
      "emailVerified": true,
      "firstName": "Alice",
      "lastName": "Kim",
      "credentials": [{ "type": "password", "value": "alice1234", "temporary": false }],
      "groups": ["/engineering"]
    },
    {
      "username": "bob",
      "enabled": true,
      "email": "bob@example.com",
      "emailVerified": true,
      "firstName": "Bob",
      "lastName": "Lee",
      "credentials": [{ "type": "password", "value": "bob1234", "temporary": false }],
      "groups": []
    }
  ]
}
```

- [ ] **Step 3: .env.example 작성 후 .env로 복사**

`.env.example`:
```
DATABASE_URL=postgresql://wiki:wiki@localhost:5433/wiki
AUTH_SECRET=dev-secret-change-me
AUTH_URL=http://localhost:3000
AUTH_KEYCLOAK_ID=simple-wiki-app
AUTH_KEYCLOAK_SECRET=dev-only-secret
AUTH_KEYCLOAK_ISSUER=http://localhost:8080/realms/simple-wiki
ATTACHMENTS_DIR=./data/attachments
```

Run: `cp .env.example .env`

- [ ] **Step 4: 기동 검증**

Run: `docker compose up -d` 후 Keycloak 기동 대기(~30초), 이후:
```bash
curl -sf http://localhost:8080/realms/simple-wiki/.well-known/openid-configuration | head -c 200
docker compose exec postgres pg_isready -U wiki
```
Expected: OIDC discovery JSON 출력(`"issuer":"http://localhost:8080/realms/simple-wiki"` 포함), `accepting connections`.

- [ ] **Step 5: Commit**

```bash
git add docker-compose.yml keycloak/realm-export.json .env.example
git commit -m "chore: docker-compose에 PostgreSQL + Keycloak(realm 자동 임포트) 구성"
```

---

### Task 3: Prisma 스키마 + 마이그레이션(FTS 포함) + 시드

**Files:**
- Create: `prisma/schema.prisma`, `prisma/seed.ts`, `src/lib/db.ts`
- Create(생성 후 수정): `prisma/migrations/<timestamp>_init/migration.sql`

**Interfaces:**
- Produces: `prisma` 클라이언트 싱글턴 `import { prisma } from "@/lib/db"`.
  모델: `User`(id=Keycloak sub), `Space`, `SpacePermission`, `Page`, `PageRevision`, `PageLink`, `Attachment`.
  enum 문자열 값: `SpaceVisibility = organization|restricted`, `SpaceRole = viewer|editor|admin`, `SubjectType = user|group`.
  시드: 스페이스 `notice`(organization), `eng`(restricted, `/engineering` 그룹에 editor).

- [ ] **Step 1: prisma/schema.prisma 작성**

```prisma
generator client {
  provider        = "prisma-client-js"
  previewFeatures = ["postgresqlExtensions"]
}

datasource db {
  provider   = "postgresql"
  url        = env("DATABASE_URL")
  extensions = [pg_trgm]
}

// id는 Keycloak ID 토큰의 sub 클레임을 그대로 사용한다.
model User {
  id        String   @id
  email     String   @default("")
  name      String   @default("")
  createdAt DateTime @default(now())
}

enum SpaceVisibility {
  organization
  restricted
}

enum SpaceRole {
  viewer
  editor
  admin
}

enum SubjectType {
  user
  group
}

model Space {
  id          String            @id @default(cuid())
  key         String            @unique
  name        String
  description String            @default("")
  visibility  SpaceVisibility   @default(organization)
  createdAt   DateTime          @default(now())
  pages       Page[]
  permissions SpacePermission[]
  attachments Attachment[]
}

model SpacePermission {
  id          String      @id @default(cuid())
  spaceId     String
  space       Space       @relation(fields: [spaceId], references: [id], onDelete: Cascade)
  subjectType SubjectType
  // subjectType=user면 User.id(=Keycloak sub), group이면 Keycloak 그룹 경로(예: "/engineering")
  subjectRef  String
  role        SpaceRole

  @@unique([spaceId, subjectType, subjectRef])
}

model Page {
  id           String                   @id @default(cuid())
  spaceId      String
  space        Space                    @relation(fields: [spaceId], references: [id], onDelete: Cascade)
  slug         String
  title        String
  content      String                   @default("")
  // 마이그레이션 SQL에서 GENERATED ALWAYS 컬럼으로 교체된다 (Step 3)
  searchVector Unsupported("tsvector")?
  createdById  String
  updatedById  String
  createdAt    DateTime                 @default(now())
  updatedAt    DateTime                 @updatedAt
  revisions    PageRevision[]
  linksFrom    PageLink[]

  @@unique([spaceId, slug])
  @@index([searchVector], type: Gin)
  @@index([title(ops: raw("gin_trgm_ops"))], type: Gin, map: "Page_title_trgm_idx")
}

model PageRevision {
  id        String   @id @default(cuid())
  pageId    String
  page      Page     @relation(fields: [pageId], references: [id], onDelete: Cascade)
  version   Int
  title     String
  content   String
  authorId  String
  createdAt DateTime @default(now())

  @@unique([pageId, version])
}

model PageLink {
  id         String @id @default(cuid())
  fromPageId String
  fromPage   Page   @relation(fields: [fromPageId], references: [id], onDelete: Cascade)
  toSpaceId  String
  toSlug     String

  @@unique([fromPageId, toSpaceId, toSlug])
  @@index([toSpaceId, toSlug])
}

model Attachment {
  id         String   @id @default(cuid())
  spaceId    String
  space      Space    @relation(fields: [spaceId], references: [id], onDelete: Cascade)
  pageId     String?
  filename   String
  mime       String
  size       Int
  storageKey String   @unique
  uploaderId String
  createdAt  DateTime @default(now())
}
```

- [ ] **Step 2: src/lib/db.ts 작성**

```ts
import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma = globalForPrisma.prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
```

- [ ] **Step 3: 마이그레이션 생성 후 FTS SQL 수동 추가**

Run: `npx prisma migrate dev --name init --create-only`

생성된 `prisma/migrations/<timestamp>_init/migration.sql`에서 두 가지를 수정한다:

1. `CREATE TABLE "Page"` 안의 `"searchVector" tsvector,` 라인을 아래로 교체:
```sql
    "searchVector" tsvector GENERATED ALWAYS AS (to_tsvector('simple', coalesce("title", '') || ' ' || coalesce("content", ''))) STORED,
```
2. 파일 맨 위에 extension, 맨 아래에 인덱스 추가:
```sql
-- 파일 맨 위
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- 파일 맨 아래
CREATE INDEX "Page_searchVector_idx" ON "Page" USING GIN ("searchVector");
CREATE INDEX "Page_title_trgm_idx" ON "Page" USING GIN ("title" gin_trgm_ops);
```

Run: `npx prisma migrate dev`
Expected: 마이그레이션 적용 성공, `Your database is now in sync`.

주의: 이후 `prisma migrate dev` 실행 시 Prisma는 generated 컬럼 여부를 추적하지 않으므로 `searchVector` 관련 drift 경고가 나올 수 있다. 스키마의 `Unsupported("tsvector")?` 선언을 유지하는 한 컬럼을 드롭하지 않는다.

- [ ] **Step 4: prisma/seed.ts 작성**

```ts
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

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

  await prisma.spacePermission.upsert({
    where: {
      spaceId_subjectType_subjectRef: { spaceId: eng.id, subjectType: "group", subjectRef: "/engineering" },
    },
    update: { role: "editor" },
    create: { spaceId: eng.id, subjectType: "group", subjectRef: "/engineering", role: "editor" },
  });

  console.log("seed 완료: notice(organization), eng(restricted, /engineering=editor)");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
```

Run: `npm run db:seed`
Expected: `seed 완료: ...` 출력.

- [ ] **Step 5: 검증 및 Commit**

```bash
docker compose exec postgres psql -U wiki -d wiki -c '\d "Page"' | grep -i searchvector
```
Expected: `searchVector | tsvector | ... generated always as ...` 표시.

```bash
git add prisma src/lib/db.ts
git commit -m "feat: Prisma 스키마(스페이스/페이지/권한/이력/첨부) + FTS 마이그레이션 + 시드"
```

---

### Task 4: slug 유틸 + 권한 판정 순수 로직 (TDD)

**Files:**
- Create: `src/lib/slug.ts`, `src/lib/permissions.ts`
- Test: `tests/slug.test.ts`, `tests/permissions.test.ts`

**Interfaces:**
- Produces:
  - `slugify(title: string): string` — 한글 보존, 소문자화, 비문자·숫자 → `-`
  - `type SpaceRole = "viewer" | "editor" | "admin"`
  - `type SpaceVisibility = "organization" | "restricted"`
  - `interface SessionInfo { userId: string; groups: string[]; isWikiAdmin: boolean }`
  - `interface PermissionEntry { subjectType: "user" | "group"; subjectRef: string; role: SpaceRole }`
  - `resolveSpaceRole(session: SessionInfo, visibility: SpaceVisibility, permissions: PermissionEntry[]): SpaceRole | null`
  - `hasRole(actual: SpaceRole | null, required: SpaceRole): boolean`
- Consumes: 없음 (순수 로직. Prisma enum과 값이 문자열로 일치하므로 DB 결과를 그대로 넘길 수 있다)

- [ ] **Step 1: 실패하는 테스트 작성**

`tests/slug.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { slugify } from "@/lib/slug";

describe("slugify", () => {
  it("공백을 하이픈으로, 소문자로", () => {
    expect(slugify("Hello World")).toBe("hello-world");
  });
  it("한글을 보존한다", () => {
    expect(slugify("배포 가이드")).toBe("배포-가이드");
  });
  it("특수문자를 제거하고 앞뒤 하이픈을 정리한다", () => {
    expect(slugify("  배포 가이드 (v2)!  ")).toBe("배포-가이드-v2");
  });
  it("사용 가능한 문자가 없으면 빈 문자열", () => {
    expect(slugify("!!!")).toBe("");
  });
});
```

`tests/permissions.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { resolveSpaceRole, hasRole, type SessionInfo, type PermissionEntry } from "@/lib/permissions";

const alice: SessionInfo = { userId: "alice-sub", groups: ["/engineering"], isWikiAdmin: false };
const bob: SessionInfo = { userId: "bob-sub", groups: [], isWikiAdmin: false };
const admin: SessionInfo = { userId: "admin-sub", groups: [], isWikiAdmin: true };

const perms: PermissionEntry[] = [
  { subjectType: "group", subjectRef: "/engineering", role: "editor" },
  { subjectType: "user", subjectRef: "bob-sub", role: "viewer" },
];

describe("resolveSpaceRole", () => {
  it("wiki-admin은 항상 admin", () => {
    expect(resolveSpaceRole(admin, "restricted", [])).toBe("admin");
  });
  it("그룹 권한 매칭", () => {
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
      { subjectType: "group", subjectRef: "/engineering", role: "viewer" },
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

- [ ] **Step 2: 테스트 실패 확인**

Run: `npm test`
Expected: FAIL — `Cannot find module '@/lib/slug'` 류의 에러.

- [ ] **Step 3: 구현**

`src/lib/slug.ts`:
```ts
export function slugify(title: string): string {
  return title
    .normalize("NFC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "");
}
```

`src/lib/permissions.ts`:
```ts
export type SpaceRole = "viewer" | "editor" | "admin";
export type SpaceVisibility = "organization" | "restricted";

export interface SessionInfo {
  userId: string;
  groups: string[];
  isWikiAdmin: boolean;
}

export interface PermissionEntry {
  subjectType: "user" | "group";
  subjectRef: string;
  role: SpaceRole;
}

const LEVEL: Record<SpaceRole, number> = { viewer: 1, editor: 2, admin: 3 };

export function resolveSpaceRole(
  session: SessionInfo,
  visibility: SpaceVisibility,
  permissions: PermissionEntry[],
): SpaceRole | null {
  if (session.isWikiAdmin) return "admin";
  let best: SpaceRole | null = null;
  for (const p of permissions) {
    const matches =
      p.subjectType === "user"
        ? p.subjectRef === session.userId
        : session.groups.includes(p.subjectRef);
    if (matches && (best === null || LEVEL[p.role] > LEVEL[best])) best = p.role;
  }
  if (best === null && visibility === "organization") return "viewer";
  return best;
}

export function hasRole(actual: SpaceRole | null, required: SpaceRole): boolean {
  return actual !== null && LEVEL[actual] >= LEVEL[required];
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npm test`
Expected: PASS (smoke 포함 전부).

- [ ] **Step 5: Commit**

```bash
git add src/lib/slug.ts src/lib/permissions.ts tests/slug.test.ts tests/permissions.test.ts
git commit -m "feat: slugify + 스페이스 권한 판정 로직 (TDD)"
```

---

### Task 5: 위키링크 파서 + remark 플러그인 (TDD)

**Files:**
- Create: `src/lib/wiki-links.ts`
- Test: `tests/wiki-links.test.ts`

**Interfaces:**
- Consumes: `slugify` (Task 4)
- Produces:
  - `interface WikiLink { target: string; label: string; slug: string }`
  - `extractWikiLinks(markdown: string): WikiLink[]` — `[[대상]]`, `[[대상|라벨]]` 추출, slug 기준 중복 제거
  - `remarkWikiLinks(options: { spaceKey: string; existingSlugs: Set<string> })` — remark 플러그인.
    존재하는 페이지 → `/s/{spaceKey}/{slug}` + class `wiki-link`,
    없는 페이지 → `/s/{spaceKey}/new?title=...` + class `wiki-link wiki-link-missing`
- 알려진 한계(허용): `extractWikiLinks`는 원문 정규식 매칭이라 코드블록 안의 `[[...]]`도 잡는다. v1에서는 허용.

- [ ] **Step 1: 실패하는 테스트 작성**

`tests/wiki-links.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { extractWikiLinks, remarkWikiLinks } from "@/lib/wiki-links";
import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkRehype from "remark-rehype";
import rehypeStringify from "rehype-stringify";

describe("extractWikiLinks", () => {
  it("기본 링크와 라벨 링크를 추출한다", () => {
    const links = extractWikiLinks("[[배포 가이드]]와 [[온보딩|신규 입사자 문서]] 참고");
    expect(links).toEqual([
      { target: "배포 가이드", label: "배포 가이드", slug: "배포-가이드" },
      { target: "온보딩", label: "신규 입사자 문서", slug: "온보딩" },
    ]);
  });
  it("slug 기준으로 중복을 제거한다", () => {
    expect(extractWikiLinks("[[A B]] [[a b]]")).toHaveLength(1);
  });
  it("링크가 없으면 빈 배열", () => {
    expect(extractWikiLinks("일반 텍스트")).toEqual([]);
  });
});

async function render(md: string, existingSlugs: Set<string>) {
  const file = await unified()
    .use(remarkParse)
    .use(remarkWikiLinks, { spaceKey: "eng", existingSlugs })
    .use(remarkRehype)
    .use(rehypeStringify)
    .process(md);
  return String(file);
}

describe("remarkWikiLinks", () => {
  it("존재하는 페이지는 일반 위키링크로", async () => {
    const html = await render("[[배포 가이드]]", new Set(["배포-가이드"]));
    expect(html).toContain('href="/s/eng/%EB%B0%B0%ED%8F%AC-%EA%B0%80%EC%9D%B4%EB%93%9C"');
    expect(html).toContain('class="wiki-link"');
    expect(html).toContain(">배포 가이드</a>");
  });
  it("없는 페이지는 생성 링크(red link)로", async () => {
    const html = await render("[[없는 문서]]", new Set());
    expect(html).toContain("/s/eng/new?title=");
    expect(html).toContain("wiki-link-missing");
  });
  it("라벨을 표시 텍스트로 쓴다", async () => {
    const html = await render("[[온보딩|입사자 문서]]", new Set(["온보딩"]));
    expect(html).toContain(">입사자 문서</a>");
  });
  it("주변 텍스트를 보존한다", async () => {
    const html = await render("앞 [[문서]] 뒤", new Set(["문서"]));
    expect(html).toContain("앞 ");
    expect(html).toContain(" 뒤");
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npm test`
Expected: FAIL — `Cannot find module '@/lib/wiki-links'`.

- [ ] **Step 3: 구현**

`src/lib/wiki-links.ts`:
```ts
import { visit } from "unist-util-visit";
import type { Root, Text, PhrasingContent } from "mdast";
import { slugify } from "./slug";

const WIKI_LINK_RE = /\[\[([^\[\]|]+)(?:\|([^\[\]]+))?\]\]/g;

export interface WikiLink {
  target: string;
  label: string;
  slug: string;
}

export function extractWikiLinks(markdown: string): WikiLink[] {
  const links: WikiLink[] = [];
  const seen = new Set<string>();
  for (const m of markdown.matchAll(WIKI_LINK_RE)) {
    const target = m[1].trim();
    const slug = slugify(target);
    if (!slug || seen.has(slug)) continue;
    seen.add(slug);
    links.push({ target, label: (m[2] ?? target).trim(), slug });
  }
  return links;
}

interface WikiLinkOptions {
  spaceKey: string;
  existingSlugs: Set<string>;
}

export function remarkWikiLinks(options: WikiLinkOptions) {
  return (tree: Root) => {
    visit(tree, "text", (node: Text, index, parent) => {
      if (!parent || index === undefined) return;
      const value = node.value;
      WIKI_LINK_RE.lastIndex = 0;
      if (!WIKI_LINK_RE.test(value)) return;
      WIKI_LINK_RE.lastIndex = 0;

      const children: PhrasingContent[] = [];
      let last = 0;
      for (const m of value.matchAll(WIKI_LINK_RE)) {
        if (m.index! > last) children.push({ type: "text", value: value.slice(last, m.index) });
        const target = m[1].trim();
        const label = (m[2] ?? target).trim();
        const slug = slugify(target);
        const exists = options.existingSlugs.has(slug);
        const url = exists
          ? `/s/${options.spaceKey}/${encodeURIComponent(slug)}`
          : `/s/${options.spaceKey}/new?title=${encodeURIComponent(target)}`;
        children.push({
          type: "link",
          url,
          data: {
            hProperties: { className: exists ? ["wiki-link"] : ["wiki-link", "wiki-link-missing"] },
          },
          children: [{ type: "text", value: label }],
        });
        last = m.index! + m[0].length;
      }
      if (last < value.length) children.push({ type: "text", value: value.slice(last) });
      parent.children.splice(index, 1, ...children);
      return index + children.length;
    });
  };
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/wiki-links.ts tests/wiki-links.test.ts
git commit -m "feat: [[위키링크]] 추출기 + remark 플러그인 (TDD)"
```

---

### Task 6: 마크다운 렌더 파이프라인 (TDD)

**Files:**
- Create: `src/lib/markdown.ts`
- Test: `tests/markdown.test.ts`

**Interfaces:**
- Consumes: `remarkWikiLinks` (Task 5)
- Produces: `renderMarkdown(markdown: string, opts: { spaceKey: string; existingSlugs: Set<string> }): Promise<string>` — sanitize된 HTML 문자열. GFM 지원, 코드블록 shiki 하이라이트, `<script>` 등 위험 요소 제거.

- [ ] **Step 1: 실패하는 테스트 작성**

`tests/markdown.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { renderMarkdown } from "@/lib/markdown";

const opts = { spaceKey: "eng", existingSlugs: new Set<string>(["문서"]) };

describe("renderMarkdown", () => {
  it("기본 마크다운을 렌더링한다", async () => {
    const html = await renderMarkdown("# 제목\n\n본문 **굵게**", opts);
    expect(html).toContain("<h1>제목</h1>");
    expect(html).toContain("<strong>굵게</strong>");
  });
  it("GFM 테이블을 지원한다", async () => {
    const html = await renderMarkdown("| a | b |\n|---|---|\n| 1 | 2 |", opts);
    expect(html).toContain("<table>");
  });
  it("script 태그를 제거한다 (XSS)", async () => {
    const html = await renderMarkdown('<script>alert(1)</script>\n\n<img src=x onerror=alert(1)>', opts);
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("onerror");
  });
  it("위키링크를 변환한다", async () => {
    const html = await renderMarkdown("[[문서]]와 [[없음]]", opts);
    expect(html).toContain('class="wiki-link"');
    expect(html).toContain("wiki-link-missing");
  });
  it("코드블록을 하이라이트한다", async () => {
    const html = await renderMarkdown('```ts\nconst x = 1;\n```', opts);
    expect(html).toContain("shiki");
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npm test`
Expected: FAIL — `Cannot find module '@/lib/markdown'`.

- [ ] **Step 3: 구현**

`src/lib/markdown.ts`:
```ts
import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import remarkRehype from "remark-rehype";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import rehypeShiki from "@shikijs/rehype";
import rehypeStringify from "rehype-stringify";
import { remarkWikiLinks } from "./wiki-links";

// sanitize는 shiki보다 먼저 실행한다. shiki가 넣는 style 속성이 살아남도록.
const schema = {
  ...defaultSchema,
  attributes: {
    ...defaultSchema.attributes,
    a: [...(defaultSchema.attributes?.a ?? []), ["className", "wiki-link", "wiki-link-missing"]],
    code: [...(defaultSchema.attributes?.code ?? []), ["className", /^language-./]],
  },
};

export interface RenderOptions {
  spaceKey: string;
  existingSlugs: Set<string>;
}

export async function renderMarkdown(markdown: string, opts: RenderOptions): Promise<string> {
  const file = await unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkWikiLinks, opts)
    .use(remarkRehype)
    .use(rehypeSanitize, schema)
    .use(rehypeShiki, { theme: "github-light", fallbackLanguage: "text" })
    .use(rehypeStringify)
    .process(markdown);
  return String(file);
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npm test`
Expected: PASS. (shiki 첫 로드로 이 테스트 파일만 수 초 걸릴 수 있음)

- [ ] **Step 5: Commit**

```bash
git add src/lib/markdown.ts tests/markdown.test.ts
git commit -m "feat: sanitize + shiki + 위키링크 지원 마크다운 렌더 파이프라인 (TDD)"
```

---

### Task 7: Auth.js(Keycloak) 인증 + 접근 제어 헬퍼 + 헤더

**Files:**
- Create: `src/auth.ts`, `src/app/api/auth/[...nextauth]/route.ts`, `src/types/next-auth.d.ts`
- Create: `src/lib/access.ts`, `src/app/denied/page.tsx`, `src/app/not-found.tsx`, `src/components/Header.tsx`
- Modify: `src/app/layout.tsx` (헤더 추가 버전으로 교체)

**Interfaces:**
- Consumes: `prisma` (Task 3), `resolveSpaceRole`/`hasRole`/`SessionInfo`/`SpaceRole` (Task 4), Keycloak 클레임 `groups`/`realm_roles` (Task 2)
- Produces:
  - `auth`, `signIn`, `signOut`, `handlers` from `@/auth`
  - `getSessionInfo(): Promise<SessionInfo | null>` — API route용, 리다이렉트 없음
  - `requireSession(): Promise<SessionInfo>` — 미로그인 시 로그인으로 redirect
  - `requireSpaceRole(spaceKey: string, required: SpaceRole): Promise<{ session: SessionInfo; space: SpaceWithPermissions; role: SpaceRole }>` — 스페이스 없음/restricted 무권한 → `notFound()`, organization에서 상위 역할 부족 → `redirect("/denied")`
  - `listReadableSpaces(session: SessionInfo)` — 읽기 가능한 스페이스 배열
  - `SpaceWithPermissions` = `Prisma Space & { permissions: SpacePermission[] }`

- [ ] **Step 1: src/auth.ts 작성**

```ts
import NextAuth from "next-auth";
import Keycloak from "next-auth/providers/keycloak";
import { prisma } from "@/lib/db";

// User.id = Keycloak sub. 첫 로그인(및 매 로그인) 시 프로필을 upsert한다.
export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [Keycloak],
  callbacks: {
    async jwt({ token, profile, trigger }) {
      if (trigger === "signIn" && profile?.sub) {
        const p = profile as {
          sub: string;
          email?: string;
          name?: string;
          preferred_username?: string;
          groups?: string[];
          realm_roles?: string[];
        };
        token.sub = p.sub;
        token.groups = p.groups ?? [];
        token.realmRoles = p.realm_roles ?? [];
        await prisma.user.upsert({
          where: { id: p.sub },
          update: { email: p.email ?? "", name: p.name ?? p.preferred_username ?? "" },
          create: { id: p.sub, email: p.email ?? "", name: p.name ?? p.preferred_username ?? "" },
        });
      }
      return token;
    },
    async session({ session, token }) {
      session.user.id = token.sub!;
      session.groups = (token.groups as string[]) ?? [];
      session.isWikiAdmin = ((token.realmRoles as string[]) ?? []).includes("wiki-admin");
      return session;
    },
  },
});
```

`src/types/next-auth.d.ts`:
```ts
import "next-auth";
import "next-auth/jwt";

declare module "next-auth" {
  interface Session {
    groups: string[];
    isWikiAdmin: boolean;
    user: { id: string; name?: string | null; email?: string | null };
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    groups?: string[];
    realmRoles?: string[];
  }
}
```

`src/app/api/auth/[...nextauth]/route.ts`:
```ts
import { handlers } from "@/auth";

export const { GET, POST } = handlers;
```

- [ ] **Step 2: src/lib/access.ts 작성**

```ts
import { notFound, redirect } from "next/navigation";
import type { Space, SpacePermission } from "@prisma/client";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { hasRole, resolveSpaceRole, type SessionInfo, type SpaceRole } from "@/lib/permissions";

export type SpaceWithPermissions = Space & { permissions: SpacePermission[] };

export async function getSessionInfo(): Promise<SessionInfo | null> {
  const session = await auth();
  if (!session?.user?.id) return null;
  return {
    userId: session.user.id,
    groups: session.groups ?? [],
    isWikiAdmin: session.isWikiAdmin ?? false,
  };
}

export async function requireSession(): Promise<SessionInfo> {
  const session = await getSessionInfo();
  if (!session) redirect("/api/auth/signin");
  return session;
}

export async function requireSpaceRole(spaceKey: string, required: SpaceRole) {
  const session = await requireSession();
  const space = await prisma.space.findUnique({
    where: { key: spaceKey },
    include: { permissions: true },
  });
  if (!space) notFound();
  const role = resolveSpaceRole(session, space.visibility, space.permissions);
  if (!hasRole(role, required)) {
    // 스페이스 자체를 볼 수 없으면 존재를 숨긴다(404). 볼 수는 있는데 역할이 부족하면 403 성격의 /denied.
    if (role === null) notFound();
    redirect("/denied");
  }
  return { session, space, role: role! };
}

export async function listReadableSpaces(session: SessionInfo): Promise<SpaceWithPermissions[]> {
  const spaces = await prisma.space.findMany({
    include: { permissions: true },
    orderBy: { name: "asc" },
  });
  return spaces.filter((s) => hasRole(resolveSpaceRole(session, s.visibility, s.permissions), "viewer"));
}
```

- [ ] **Step 3: 헤더/레이아웃/에러 페이지 작성**

`src/components/Header.tsx`:
```tsx
import Link from "next/link";
import { auth, signIn, signOut } from "@/auth";

export async function Header() {
  const session = await auth();
  return (
    <header className="flex items-center gap-4 border-b border-gray-200 py-3">
      <Link href="/" className="font-bold">
        simple-wiki
      </Link>
      <form action="/search" method="GET" className="flex-1">
        <input
          type="search"
          name="q"
          placeholder="검색"
          className="w-full max-w-sm rounded border border-gray-300 px-2 py-1 text-sm"
        />
      </form>
      {session?.user ? (
        <div className="flex items-center gap-2 text-sm">
          <span>{session.user.name}</span>
          <form
            action={async () => {
              "use server";
              await signOut();
            }}
          >
            <button className="text-gray-500 underline">로그아웃</button>
          </form>
        </div>
      ) : (
        <form
          action={async () => {
            "use server";
            await signIn("keycloak");
          }}
        >
          <button className="text-sm underline">로그인</button>
        </form>
      )}
    </header>
  );
}
```

`src/app/layout.tsx` (교체):
```tsx
import "./globals.css";
import { Header } from "@/components/Header";

export const metadata = { title: "simple-wiki" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <body className="mx-auto max-w-4xl px-4">
        <Header />
        {children}
      </body>
    </html>
  );
}
```

`src/app/denied/page.tsx`:
```tsx
import Link from "next/link";

export default function DeniedPage() {
  return (
    <main className="py-16 text-center">
      <h1 className="text-xl font-bold">권한이 없습니다</h1>
      <p className="mt-2 text-gray-500">이 작업을 수행할 권한이 없습니다. 스페이스 관리자에게 문의하세요.</p>
      <Link href="/" className="mt-4 inline-block underline">
        홈으로
      </Link>
    </main>
  );
}
```

`src/app/not-found.tsx`:
```tsx
import Link from "next/link";

export default function NotFound() {
  return (
    <main className="py-16 text-center">
      <h1 className="text-xl font-bold">페이지를 찾을 수 없습니다</h1>
      <Link href="/" className="mt-4 inline-block underline">
        홈으로
      </Link>
    </main>
  );
}
```

- [ ] **Step 4: 수동 검증**

Run: `docker compose up -d` 상태에서 `npm run dev`
- `http://localhost:3000` 접속 → 헤더에 "로그인" 표시.
- 로그인 클릭 → Keycloak 로그인 화면 → `alice/alice1234` → 돌아와서 헤더에 "Alice Kim" 표시.
- `npm run build` → Expected: 타입 에러 없이 성공.

- [ ] **Step 5: Commit**

```bash
git add src/auth.ts src/types src/lib/access.ts src/app src/components
git commit -m "feat: Keycloak OIDC 로그인(Auth.js) + 세션/스페이스 접근 제어 헬퍼"
```

---

### Task 8: 홈(스페이스 목록) + 스페이스 생성

**Files:**
- Create: `src/actions/spaces.ts`, `src/app/spaces/new/page.tsx`
- Modify: `src/app/page.tsx` (스페이스 목록으로 교체)

**Interfaces:**
- Consumes: `requireSession`/`listReadableSpaces` (Task 7), `slugify` (Task 4), `prisma` (Task 3)
- Produces: 서버 액션 `createSpace(formData: FormData): Promise<void>` (fields: `key`, `name`, `description`, `visibility`) — wiki-admin 전용.
  이후 태스크가 쓰는 URL 구조: 스페이스 홈 `/s/{key}` (Task 11).

- [ ] **Step 1: src/actions/spaces.ts 작성 (스페이스 생성 부분)**

```ts
"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requireSession } from "@/lib/access";

const SPACE_KEY_RE = /^[a-z0-9][a-z0-9-]{1,31}$/;

export async function createSpace(formData: FormData) {
  const session = await requireSession();
  if (!session.isWikiAdmin) redirect("/denied");

  const key = String(formData.get("key") ?? "").trim();
  const name = String(formData.get("name") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim();
  const visibility = formData.get("visibility") === "restricted" ? "restricted" : "organization";

  if (!SPACE_KEY_RE.test(key)) throw new Error("키는 소문자/숫자/하이픈 2~32자여야 합니다.");
  if (!name) throw new Error("이름을 입력하세요.");
  const dup = await prisma.space.findUnique({ where: { key } });
  if (dup) throw new Error("이미 존재하는 키입니다.");

  await prisma.space.create({ data: { key, name, description, visibility } });
  revalidatePath("/");
  redirect(`/s/${key}`);
}
```

- [ ] **Step 2: 홈 페이지 교체**

`src/app/page.tsx` (비로그인 사용자도 홈은 볼 수 있어야 헤더의 "로그인" 버튼으로 진입할 수 있다):
```tsx
import Link from "next/link";
import { getSessionInfo, listReadableSpaces } from "@/lib/access";

export default async function Home() {
  const session = await getSessionInfo();
  if (!session) {
    return (
      <main className="py-16 text-center text-gray-500">
        상단의 로그인 버튼으로 시작하세요.
      </main>
    );
  }
  const spaces = await listReadableSpaces(session);
  return (
    <main className="py-8">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">스페이스</h1>
        {session.isWikiAdmin && (
          <Link href="/spaces/new" className="rounded bg-blue-600 px-3 py-1.5 text-sm text-white">
            새 스페이스
          </Link>
        )}
      </div>
      <ul className="mt-6 space-y-2">
        {spaces.map((s) => (
          <li key={s.id} className="rounded border border-gray-200 p-4">
            <Link href={`/s/${s.key}`} className="font-semibold text-blue-600 underline">
              {s.name}
            </Link>
            <span className="ml-2 text-xs text-gray-400">
              {s.visibility === "restricted" ? "제한" : "전사 공개"}
            </span>
            {s.description && <p className="mt-1 text-sm text-gray-500">{s.description}</p>}
          </li>
        ))}
        {spaces.length === 0 && <li className="text-gray-500">접근 가능한 스페이스가 없습니다.</li>}
      </ul>
    </main>
  );
}
```

- [ ] **Step 3: 스페이스 생성 폼 작성**

`src/app/spaces/new/page.tsx`:
```tsx
import { redirect } from "next/navigation";
import { requireSession } from "@/lib/access";
import { createSpace } from "@/actions/spaces";

export default async function NewSpacePage() {
  const session = await requireSession();
  if (!session.isWikiAdmin) redirect("/denied");
  return (
    <main className="py-8">
      <h1 className="text-2xl font-bold">새 스페이스</h1>
      <form action={createSpace} className="mt-6 max-w-md space-y-4">
        <label className="block text-sm">
          키 (URL용, 소문자/숫자/하이픈)
          <input name="key" required pattern="[a-z0-9][a-z0-9-]{1,31}" className="mt-1 w-full rounded border border-gray-300 px-2 py-1" />
        </label>
        <label className="block text-sm">
          이름
          <input name="name" required className="mt-1 w-full rounded border border-gray-300 px-2 py-1" />
        </label>
        <label className="block text-sm">
          설명
          <input name="description" className="mt-1 w-full rounded border border-gray-300 px-2 py-1" />
        </label>
        <label className="block text-sm">
          공개 범위
          <select name="visibility" className="mt-1 w-full rounded border border-gray-300 px-2 py-1">
            <option value="organization">전사 공개 (로그인 사용자 모두 읽기)</option>
            <option value="restricted">제한 (권한 부여된 대상만)</option>
          </select>
        </label>
        <button className="rounded bg-blue-600 px-4 py-2 text-sm text-white">만들기</button>
      </form>
    </main>
  );
}
```

- [ ] **Step 4: 수동 검증**

`npm run dev` 상태에서:
- `alice`로 로그인 → 홈에 "공지사항", "엔지니어링" 표시(시드), "새 스페이스" 버튼 없음.
- `bob`으로 로그인 → "공지사항"만 표시.
- `wiki-admin`으로 로그인 → "새 스페이스"로 `docs / 문서` 생성 → `/s/docs` 리다이렉트(아직 404 — Task 11에서 구현. 홈에 목록 표시되는 것까지 확인).
- `npm run build` → 성공.

- [ ] **Step 5: Commit**

```bash
git add src/actions/spaces.ts src/app/page.tsx src/app/spaces
git commit -m "feat: 스페이스 목록 홈 + wiki-admin 스페이스 생성"
```

---

### Task 9: 스페이스 설정 — 권한 관리 UI

**Files:**
- Modify: `src/actions/spaces.ts` (권한 관리 액션 추가)
- Create: `src/app/s/[spaceKey]/settings/page.tsx`

**Interfaces:**
- Consumes: `requireSpaceRole` (Task 7), `prisma` (Task 3)
- Produces: 서버 액션
  - `updateSpaceVisibility(spaceKey: string, formData: FormData)` (field: `visibility`)
  - `addSpacePermission(spaceKey: string, formData: FormData)` (fields: `subjectType`=`user|group`, `subjectValue`, `role`) — `user`면 `subjectValue`는 이메일(가입된 User를 이메일로 조회해 id로 변환), `group`이면 Keycloak 그룹 경로(`/engineering`)
  - `removeSpacePermission(spaceKey: string, permissionId: string)`
- 참고: 사용자에게 권한을 주려면 그 사용자가 최소 1회 로그인해서 User 레코드가 있어야 한다. 없으면 에러 메시지.

- [ ] **Step 1: src/actions/spaces.ts에 권한 액션 추가**

파일 끝에 추가:
```ts
import { requireSpaceRole } from "@/lib/access"; // 파일 상단 import에 병합

export async function updateSpaceVisibility(spaceKey: string, formData: FormData) {
  const { space } = await requireSpaceRole(spaceKey, "admin");
  const visibility = formData.get("visibility") === "restricted" ? "restricted" : "organization";
  await prisma.space.update({ where: { id: space.id }, data: { visibility } });
  revalidatePath(`/s/${spaceKey}/settings`);
  revalidatePath("/");
}

export async function addSpacePermission(spaceKey: string, formData: FormData) {
  const { space } = await requireSpaceRole(spaceKey, "admin");
  const subjectType = formData.get("subjectType") === "group" ? "group" : "user";
  const subjectValue = String(formData.get("subjectValue") ?? "").trim();
  const roleInput = String(formData.get("role") ?? "viewer");
  const role = roleInput === "admin" ? "admin" : roleInput === "editor" ? "editor" : "viewer";
  if (!subjectValue) throw new Error("대상을 입력하세요.");

  let subjectRef = subjectValue;
  if (subjectType === "user") {
    const user = await prisma.user.findFirst({ where: { email: subjectValue } });
    if (!user) throw new Error("해당 이메일의 사용자가 없습니다. 사용자가 최소 1회 로그인해야 합니다.");
    subjectRef = user.id;
  } else if (!subjectValue.startsWith("/")) {
    throw new Error('그룹 경로는 "/"로 시작해야 합니다. 예: /engineering');
  }

  await prisma.spacePermission.upsert({
    where: { spaceId_subjectType_subjectRef: { spaceId: space.id, subjectType, subjectRef } },
    update: { role },
    create: { spaceId: space.id, subjectType, subjectRef, role },
  });
  revalidatePath(`/s/${spaceKey}/settings`);
}

export async function removeSpacePermission(spaceKey: string, permissionId: string) {
  const { space } = await requireSpaceRole(spaceKey, "admin");
  await prisma.spacePermission.deleteMany({ where: { id: permissionId, spaceId: space.id } });
  revalidatePath(`/s/${spaceKey}/settings`);
}
```

- [ ] **Step 2: 설정 페이지 작성**

`src/app/s/[spaceKey]/settings/page.tsx`:
```tsx
import { requireSpaceRole } from "@/lib/access";
import { prisma } from "@/lib/db";
import { addSpacePermission, removeSpacePermission, updateSpaceVisibility } from "@/actions/spaces";

export default async function SpaceSettingsPage({ params }: { params: Promise<{ spaceKey: string }> }) {
  const { spaceKey } = await params;
  const { space } = await requireSpaceRole(spaceKey, "admin");

  const userIds = space.permissions.filter((p) => p.subjectType === "user").map((p) => p.subjectRef);
  const users = await prisma.user.findMany({ where: { id: { in: userIds } } });
  const userLabel = new Map(users.map((u) => [u.id, `${u.name} <${u.email}>`]));

  return (
    <main className="py-8">
      <h1 className="text-2xl font-bold">{space.name} 설정</h1>

      <section className="mt-6">
        <h2 className="font-semibold">공개 범위</h2>
        <form action={updateSpaceVisibility.bind(null, spaceKey)} className="mt-2 flex items-center gap-2">
          <select name="visibility" defaultValue={space.visibility} className="rounded border border-gray-300 px-2 py-1 text-sm">
            <option value="organization">전사 공개</option>
            <option value="restricted">제한</option>
          </select>
          <button className="rounded bg-gray-800 px-3 py-1 text-sm text-white">저장</button>
        </form>
      </section>

      <section className="mt-8">
        <h2 className="font-semibold">권한</h2>
        <table className="mt-2 w-full text-sm">
          <thead>
            <tr className="border-b text-left text-gray-500">
              <th className="py-1">유형</th>
              <th>대상</th>
              <th>역할</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {space.permissions.map((p) => (
              <tr key={p.id} className="border-b">
                <td className="py-1">{p.subjectType === "user" ? "사용자" : "그룹"}</td>
                <td>{p.subjectType === "user" ? (userLabel.get(p.subjectRef) ?? p.subjectRef) : p.subjectRef}</td>
                <td>{p.role}</td>
                <td className="text-right">
                  <form action={removeSpacePermission.bind(null, spaceKey, p.id)}>
                    <button className="text-red-600 underline">삭제</button>
                  </form>
                </td>
              </tr>
            ))}
            {space.permissions.length === 0 && (
              <tr>
                <td colSpan={4} className="py-2 text-gray-500">부여된 권한이 없습니다.</td>
              </tr>
            )}
          </tbody>
        </table>

        <form action={addSpacePermission.bind(null, spaceKey)} className="mt-4 flex flex-wrap items-end gap-2 text-sm">
          <label>
            유형
            <select name="subjectType" className="mt-1 block rounded border border-gray-300 px-2 py-1">
              <option value="group">그룹</option>
              <option value="user">사용자(이메일)</option>
            </select>
          </label>
          <label className="flex-1">
            대상 (그룹 경로 또는 이메일)
            <input name="subjectValue" required placeholder="/engineering 또는 alice@example.com" className="mt-1 block w-full rounded border border-gray-300 px-2 py-1" />
          </label>
          <label>
            역할
            <select name="role" className="mt-1 block rounded border border-gray-300 px-2 py-1">
              <option value="viewer">viewer</option>
              <option value="editor">editor</option>
              <option value="admin">admin</option>
            </select>
          </label>
          <button className="rounded bg-blue-600 px-3 py-1.5 text-white">추가</button>
        </form>
      </section>
    </main>
  );
}
```

- [ ] **Step 3: 수동 검증**

`npm run dev` 상태에서 `wiki-admin`으로 로그인:
- `/s/eng/settings` 접속 → `/engineering` editor 권한 표시(시드).
- 그룹 `/hr` viewer 추가 → 테이블 반영. 삭제 → 사라짐.
- `alice`(eng의 editor, admin 아님)로 `/s/eng/settings` 접속 → `/denied` 리다이렉트.
- `bob`으로 `/s/eng/settings` 접속 → 404.

- [ ] **Step 4: Commit**

```bash
git add src/actions/spaces.ts src/app/s
git commit -m "feat: 스페이스 공개 범위 + 사용자/그룹 권한 관리"
```

---

### Task 10: 페이지 CRUD 서버 액션 (리비전 + 링크 동기화)

**Files:**
- Create: `src/actions/pages.ts`

**Interfaces:**
- Consumes: `requireSpaceRole` (Task 7), `slugify` (Task 4), `extractWikiLinks` (Task 5), `prisma` (Task 3)
- Produces: 서버 액션 (모두 editor 권한 필요)
  - `createPage(spaceKey: string, formData: FormData)` (fields: `title`, `content`) — slug 중복이면 해당 페이지 편집으로 redirect
  - `updatePage(spaceKey: string, slug: string, formData: FormData)` (fields: `title`, `content`) — 제목이 바뀌어도 slug는 유지(링크 안정성). 새 리비전 생성
  - `deletePage(spaceKey: string, slug: string)`
  - `restoreRevision(spaceKey: string, slug: string, version: number)` — 해당 버전 내용으로 새 리비전 생성
- 저장 규칙: 모든 쓰기는 트랜잭션으로 Page + PageRevision(version=최대+1) + PageLink 재생성.

- [ ] **Step 1: src/actions/pages.ts 작성**

```ts
"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { requireSpaceRole } from "@/lib/access";
import { slugify } from "@/lib/slug";
import { extractWikiLinks } from "@/lib/wiki-links";

async function syncLinks(tx: Prisma.TransactionClient, pageId: string, spaceId: string, content: string) {
  await tx.pageLink.deleteMany({ where: { fromPageId: pageId } });
  const links = extractWikiLinks(content);
  if (links.length > 0) {
    await tx.pageLink.createMany({
      data: links.map((l) => ({ fromPageId: pageId, toSpaceId: spaceId, toSlug: l.slug })),
    });
  }
}

async function nextVersion(tx: Prisma.TransactionClient, pageId: string): Promise<number> {
  const last = await tx.pageRevision.aggregate({ where: { pageId }, _max: { version: true } });
  return (last._max.version ?? 0) + 1;
}

export async function createPage(spaceKey: string, formData: FormData) {
  const { session, space } = await requireSpaceRole(spaceKey, "editor");
  const title = String(formData.get("title") ?? "").trim();
  const content = String(formData.get("content") ?? "");
  if (!title) throw new Error("제목을 입력하세요.");
  const slug = slugify(title);
  if (!slug) throw new Error("제목에 사용할 수 있는 문자가 없습니다.");

  const existing = await prisma.page.findUnique({
    where: { spaceId_slug: { spaceId: space.id, slug } },
  });
  if (existing) redirect(`/s/${spaceKey}/${encodeURIComponent(slug)}/edit`);

  await prisma.$transaction(async (tx) => {
    const page = await tx.page.create({
      data: { spaceId: space.id, slug, title, content, createdById: session.userId, updatedById: session.userId },
    });
    await tx.pageRevision.create({
      data: { pageId: page.id, version: 1, title, content, authorId: session.userId },
    });
    await syncLinks(tx, page.id, space.id, content);
  });

  revalidatePath(`/s/${spaceKey}`);
  redirect(`/s/${spaceKey}/${encodeURIComponent(slug)}`);
}

async function saveRevision(
  spaceKey: string,
  slug: string,
  title: string,
  content: string,
): Promise<void> {
  const { session, space } = await requireSpaceRole(spaceKey, "editor");
  const page = await prisma.page.findUnique({
    where: { spaceId_slug: { spaceId: space.id, slug } },
  });
  if (!page) throw new Error("페이지가 없습니다.");

  await prisma.$transaction(async (tx) => {
    await tx.page.update({
      where: { id: page.id },
      data: { title, content, updatedById: session.userId },
    });
    await tx.pageRevision.create({
      data: { pageId: page.id, version: await nextVersion(tx, page.id), title, content, authorId: session.userId },
    });
    await syncLinks(tx, page.id, space.id, content);
  });

  revalidatePath(`/s/${spaceKey}`);
  revalidatePath(`/s/${spaceKey}/${encodeURIComponent(slug)}`);
}

export async function updatePage(spaceKey: string, slug: string, formData: FormData) {
  const title = String(formData.get("title") ?? "").trim();
  const content = String(formData.get("content") ?? "");
  if (!title) throw new Error("제목을 입력하세요.");
  await saveRevision(spaceKey, slug, title, content);
  redirect(`/s/${spaceKey}/${encodeURIComponent(slug)}`);
}

export async function deletePage(spaceKey: string, slug: string) {
  const { space } = await requireSpaceRole(spaceKey, "editor");
  await prisma.page.deleteMany({ where: { spaceId: space.id, slug } });
  revalidatePath(`/s/${spaceKey}`);
  redirect(`/s/${spaceKey}`);
}

export async function restoreRevision(spaceKey: string, slug: string, version: number) {
  const { space } = await requireSpaceRole(spaceKey, "editor");
  const page = await prisma.page.findUnique({
    where: { spaceId_slug: { spaceId: space.id, slug } },
  });
  if (!page) throw new Error("페이지가 없습니다.");
  const rev = await prisma.pageRevision.findUnique({
    where: { pageId_version: { pageId: page.id, version } },
  });
  if (!rev) throw new Error("해당 버전이 없습니다.");
  await saveRevision(spaceKey, slug, rev.title, rev.content);
  redirect(`/s/${spaceKey}/${encodeURIComponent(slug)}`);
}
```

참고: `"use server"` 파일에서 export되지 않은 `syncLinks`/`nextVersion`/`saveRevision`은 액션이 아니라 내부 헬퍼다.

- [ ] **Step 2: 타입/빌드 검증**

Run: `npm run build`
Expected: 성공. (UI 연결은 Task 11~12에서, 동작 검증은 그때 수동+e2e)

- [ ] **Step 3: Commit**

```bash
git add src/actions/pages.ts
git commit -m "feat: 페이지 CRUD 액션 - 트랜잭션으로 리비전/위키링크 동기화"
```

---

### Task 11: 스페이스 홈(페이지 목록) + 페이지 보기(백링크 포함)

**Files:**
- Create: `src/app/s/[spaceKey]/page.tsx`, `src/app/s/[spaceKey]/[slug]/page.tsx`
- Create: `src/components/ConfirmSubmitButton.tsx`

**Interfaces:**
- Consumes: `requireSpaceRole` (Task 7), `renderMarkdown` (Task 6), `extractWikiLinks` (Task 5), `deletePage` (Task 10)
- Produces: URL 구조 확정 — `/s/{key}` 목록, `/s/{key}/{slug}` 보기. 없는 slug → "페이지 만들기" 제안(editor일 때).
  `ConfirmSubmitButton` — confirm() 후 제출하는 클라이언트 버튼(이후 태스크 재사용 가능).

- [ ] **Step 1: ConfirmSubmitButton 작성**

`src/components/ConfirmSubmitButton.tsx`:
```tsx
"use client";

export function ConfirmSubmitButton({ message, children, className }: {
  message: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <button
      className={className}
      onClick={(e) => {
        if (!confirm(message)) e.preventDefault();
      }}
    >
      {children}
    </button>
  );
}
```

- [ ] **Step 2: 스페이스 홈 작성**

`src/app/s/[spaceKey]/page.tsx`:
```tsx
import Link from "next/link";
import { requireSpaceRole } from "@/lib/access";
import { prisma } from "@/lib/db";
import { hasRole } from "@/lib/permissions";

export default async function SpaceHome({ params }: { params: Promise<{ spaceKey: string }> }) {
  const { spaceKey } = await params;
  const { space, role } = await requireSpaceRole(spaceKey, "viewer");
  const pages = await prisma.page.findMany({
    where: { spaceId: space.id },
    orderBy: { updatedAt: "desc" },
    select: { id: true, slug: true, title: true, updatedAt: true },
  });
  return (
    <main className="py-8">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">{space.name}</h1>
        <div className="flex gap-2 text-sm">
          {hasRole(role, "editor") && (
            <Link href={`/s/${spaceKey}/new`} className="rounded bg-blue-600 px-3 py-1.5 text-white">
              새 페이지
            </Link>
          )}
          {hasRole(role, "admin") && (
            <Link href={`/s/${spaceKey}/settings`} className="rounded border border-gray-300 px-3 py-1.5">
              설정
            </Link>
          )}
        </div>
      </div>
      {space.description && <p className="mt-1 text-gray-500">{space.description}</p>}
      <ul className="mt-6 space-y-1">
        {pages.map((p) => (
          <li key={p.id} className="flex items-baseline justify-between border-b border-gray-100 py-2">
            <Link href={`/s/${spaceKey}/${encodeURIComponent(p.slug)}`} className="text-blue-600 underline">
              {p.title}
            </Link>
            <span className="text-xs text-gray-400">{p.updatedAt.toISOString().slice(0, 10)}</span>
          </li>
        ))}
        {pages.length === 0 && <li className="text-gray-500">아직 페이지가 없습니다.</li>}
      </ul>
    </main>
  );
}
```

- [ ] **Step 3: 페이지 보기 작성**

`src/app/s/[spaceKey]/[slug]/page.tsx`:
```tsx
import Link from "next/link";
import { requireSpaceRole } from "@/lib/access";
import { prisma } from "@/lib/db";
import { hasRole } from "@/lib/permissions";
import { renderMarkdown } from "@/lib/markdown";
import { extractWikiLinks } from "@/lib/wiki-links";
import { deletePage } from "@/actions/pages";
import { ConfirmSubmitButton } from "@/components/ConfirmSubmitButton";

export default async function PageView({ params }: { params: Promise<{ spaceKey: string; slug: string }> }) {
  const { spaceKey, slug: rawSlug } = await params;
  const slug = decodeURIComponent(rawSlug);
  const { space, role } = await requireSpaceRole(spaceKey, "viewer");
  const canEdit = hasRole(role, "editor");

  const page = await prisma.page.findUnique({
    where: { spaceId_slug: { spaceId: space.id, slug } },
  });

  if (!page) {
    return (
      <main className="py-16 text-center">
        <h1 className="text-xl font-bold">아직 없는 페이지입니다</h1>
        {canEdit ? (
          <Link
            href={`/s/${spaceKey}/new?title=${encodeURIComponent(slug)}`}
            className="mt-4 inline-block rounded bg-blue-600 px-4 py-2 text-sm text-white"
          >
            이 제목으로 페이지 만들기
          </Link>
        ) : (
          <p className="mt-2 text-gray-500">편집 권한이 있는 사용자가 만들 수 있습니다.</p>
        )}
      </main>
    );
  }

  const targets = extractWikiLinks(page.content).map((l) => l.slug);
  const existing = targets.length
    ? await prisma.page.findMany({
        where: { spaceId: space.id, slug: { in: targets } },
        select: { slug: true },
      })
    : [];
  const html = await renderMarkdown(page.content, {
    spaceKey,
    existingSlugs: new Set(existing.map((p) => p.slug)),
  });

  const backlinks = await prisma.pageLink.findMany({
    where: { toSpaceId: space.id, toSlug: slug },
    include: { fromPage: { select: { title: true, slug: true } } },
  });

  return (
    <main className="py-8">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-sm text-gray-400">
            <Link href={`/s/${spaceKey}`} className="underline">{space.name}</Link>
          </p>
          <h1 className="text-2xl font-bold">{page.title}</h1>
          <p className="mt-1 text-xs text-gray-400">마지막 수정 {page.updatedAt.toISOString().slice(0, 16).replace("T", " ")}</p>
        </div>
        {canEdit && (
          <div className="flex shrink-0 gap-2 text-sm">
            <Link href={`/s/${spaceKey}/${encodeURIComponent(slug)}/edit`} className="rounded border border-gray-300 px-3 py-1.5">편집</Link>
            <Link href={`/s/${spaceKey}/${encodeURIComponent(slug)}/history`} className="rounded border border-gray-300 px-3 py-1.5">이력</Link>
            <form action={deletePage.bind(null, spaceKey, slug)}>
              <ConfirmSubmitButton message="이 페이지를 삭제할까요?" className="rounded border border-red-300 px-3 py-1.5 text-red-600">
                삭제
              </ConfirmSubmitButton>
            </form>
          </div>
        )}
      </div>

      <article className="prose-wiki mt-6" dangerouslySetInnerHTML={{ __html: html }} />

      {backlinks.length > 0 && (
        <aside className="mt-10 border-t border-gray-200 pt-4">
          <h2 className="text-sm font-semibold text-gray-500">이 페이지를 링크한 문서</h2>
          <ul className="mt-2 space-y-1 text-sm">
            {backlinks.map((b) => (
              <li key={b.id}>
                <Link href={`/s/${spaceKey}/${encodeURIComponent(b.fromPage.slug)}`} className="text-blue-600 underline">
                  {b.fromPage.title}
                </Link>
              </li>
            ))}
          </ul>
        </aside>
      )}
    </main>
  );
}
```

참고: `dangerouslySetInnerHTML`은 `renderMarkdown`이 rehype-sanitize를 통과한 HTML만 받으므로 안전하다.

- [ ] **Step 4: 수동 검증**

라우팅 주의: `/s/{key}/new`는 Task 12에서 만들 정적 세그먼트다. Next.js는 정적 세그먼트(`new`)를 동적 세그먼트(`[slug]`)보다 우선하므로 충돌 없음. 이 태스크 시점에는 `/s/eng` 목록과 없는 페이지 화면("아직 없는 페이지입니다")까지만 확인:
- `alice` 로그인 → `/s/eng` → "아직 페이지가 없습니다" + "새 페이지" 버튼.
- `/s/eng/아무거나` → "아직 없는 페이지입니다" + 만들기 버튼.
- `bob`으로 `/s/eng` → 404, `/s/notice` → 정상(읽기 전용, "새 페이지" 버튼 없음).
- `npm run build` → 성공.

- [ ] **Step 5: Commit**

```bash
git add src/app/s src/components/ConfirmSubmitButton.tsx
git commit -m "feat: 스페이스 홈 + 페이지 보기(백링크, red link, 삭제)"
```

---

### Task 12: 마크다운 에디터 + 페이지 생성/편집 화면

**Files:**
- Create: `src/actions/preview.ts`, `src/components/MarkdownEditor.tsx`
- Create: `src/app/s/[spaceKey]/new/page.tsx`, `src/app/s/[spaceKey]/[slug]/edit/page.tsx`

**Interfaces:**
- Consumes: `createPage`/`updatePage` (Task 10), `renderMarkdown` (Task 6), `requireSpaceRole` (Task 7)
- Produces:
  - 서버 액션 `previewMarkdown(spaceKey: string, content: string): Promise<string>` (viewer 권한)
  - `MarkdownEditor` props: `{ spaceKey: string; initialTitle: string; initialContent: string; onSave: (formData: FormData) => Promise<void>; preview: (content: string) => Promise<string> }`
  - 이미지 붙여넣기는 `POST /api/spaces/{spaceKey}/attachments`(Task 13)를 호출 — Task 13 전에는 "업로드 실패" alert가 뜨는 상태로 둔다.

- [ ] **Step 1: 미리보기 액션 작성**

`src/actions/preview.ts`:
```ts
"use server";

import { requireSpaceRole } from "@/lib/access";
import { renderMarkdown } from "@/lib/markdown";
import { extractWikiLinks } from "@/lib/wiki-links";
import { prisma } from "@/lib/db";

export async function previewMarkdown(spaceKey: string, content: string): Promise<string> {
  const { space } = await requireSpaceRole(spaceKey, "viewer");
  const targets = extractWikiLinks(content).map((l) => l.slug);
  const existing = targets.length
    ? await prisma.page.findMany({
        where: { spaceId: space.id, slug: { in: targets } },
        select: { slug: true },
      })
    : [];
  return renderMarkdown(content, { spaceKey, existingSlugs: new Set(existing.map((p) => p.slug)) });
}
```

- [ ] **Step 2: 에디터 컴포넌트 작성**

`src/components/MarkdownEditor.tsx`:
```tsx
"use client";

import { useEffect, useRef, useState } from "react";
import CodeMirror from "@uiw/react-codemirror";
import { markdown } from "@codemirror/lang-markdown";

interface Props {
  spaceKey: string;
  initialTitle: string;
  initialContent: string;
  onSave: (formData: FormData) => Promise<void>;
  preview: (content: string) => Promise<string>;
}

export function MarkdownEditor({ spaceKey, initialTitle, initialContent, onSave, preview }: Props) {
  const [title, setTitle] = useState(initialTitle);
  const [content, setContent] = useState(initialContent);
  const [html, setHtml] = useState("");
  const [saving, setSaving] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      preview(content).then(setHtml).catch(() => setHtml("<p>미리보기 실패</p>"));
    }, 500);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [content, preview]);

  async function handlePaste(e: React.ClipboardEvent) {
    const file = Array.from(e.clipboardData.files).find((f) => f.type.startsWith("image/"));
    if (!file) return;
    e.preventDefault();
    const fd = new FormData();
    fd.append("file", file);
    const res = await fetch(`/api/spaces/${spaceKey}/attachments`, { method: "POST", body: fd });
    if (!res.ok) {
      alert("이미지 업로드에 실패했습니다.");
      return;
    }
    const { url, filename } = (await res.json()) as { url: string; filename: string };
    setContent((c) => `${c}\n![${filename}](${url})\n`);
  }

  return (
    <form
      action={async (fd) => {
        setSaving(true);
        try {
          await onSave(fd);
        } catch {
          // redirect는 여기로 오지 않는다. 검증/저장 실패만 잡힌다 — 내용은 유지된 채 알림.
          alert("저장에 실패했습니다. 잠시 후 다시 시도하세요.");
        } finally {
          setSaving(false);
        }
      }}
    >
      <input
        name="title"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        required
        placeholder="제목"
        className="w-full rounded border border-gray-300 px-3 py-2 text-lg font-semibold"
      />
      <input type="hidden" name="content" value={content} />
      <div className="mt-4 grid grid-cols-2 gap-4" onPaste={handlePaste}>
        <div className="min-h-[400px] overflow-hidden rounded border border-gray-300">
          <CodeMirror value={content} height="400px" extensions={[markdown()]} onChange={setContent} />
        </div>
        <div className="prose-wiki min-h-[400px] overflow-auto rounded border border-gray-100 bg-gray-50 p-4"
          dangerouslySetInnerHTML={{ __html: html }}
        />
      </div>
      <p className="mt-2 text-xs text-gray-400">이미지를 붙여넣으면 자동으로 업로드됩니다. [[페이지명]]으로 위키링크를 만들 수 있습니다.</p>
      <button disabled={saving} className="mt-4 rounded bg-blue-600 px-4 py-2 text-sm text-white disabled:opacity-50">
        {saving ? "저장 중..." : "저장"}
      </button>
    </form>
  );
}
```

- [ ] **Step 3: 생성/편집 페이지 작성**

`src/app/s/[spaceKey]/new/page.tsx`:
```tsx
import { requireSpaceRole } from "@/lib/access";
import { createPage } from "@/actions/pages";
import { previewMarkdown } from "@/actions/preview";
import { MarkdownEditor } from "@/components/MarkdownEditor";

export default async function NewPagePage({
  params,
  searchParams,
}: {
  params: Promise<{ spaceKey: string }>;
  searchParams: Promise<{ title?: string }>;
}) {
  const { spaceKey } = await params;
  const { title } = await searchParams;
  await requireSpaceRole(spaceKey, "editor");
  return (
    <main className="py-8">
      <h1 className="mb-4 text-xl font-bold">새 페이지</h1>
      <MarkdownEditor
        spaceKey={spaceKey}
        initialTitle={title ?? ""}
        initialContent=""
        onSave={createPage.bind(null, spaceKey)}
        preview={previewMarkdown.bind(null, spaceKey)}
      />
    </main>
  );
}
```

`src/app/s/[spaceKey]/[slug]/edit/page.tsx`:
```tsx
import { notFound } from "next/navigation";
import { requireSpaceRole } from "@/lib/access";
import { prisma } from "@/lib/db";
import { updatePage } from "@/actions/pages";
import { previewMarkdown } from "@/actions/preview";
import { MarkdownEditor } from "@/components/MarkdownEditor";

export default async function EditPagePage({ params }: { params: Promise<{ spaceKey: string; slug: string }> }) {
  const { spaceKey, slug: rawSlug } = await params;
  const slug = decodeURIComponent(rawSlug);
  const { space } = await requireSpaceRole(spaceKey, "editor");
  const page = await prisma.page.findUnique({
    where: { spaceId_slug: { spaceId: space.id, slug } },
  });
  if (!page) notFound();
  return (
    <main className="py-8">
      <h1 className="mb-4 text-xl font-bold">페이지 편집</h1>
      <MarkdownEditor
        spaceKey={spaceKey}
        initialTitle={page.title}
        initialContent={page.content}
        onSave={updatePage.bind(null, spaceKey, slug)}
        preview={previewMarkdown.bind(null, spaceKey)}
      />
    </main>
  );
}
```

- [ ] **Step 4: 수동 검증**

`alice`로 로그인:
- `/s/eng/new` → 제목 "온보딩 가이드", 본문에 `# 환영합니다\n\n[[개발 환경]] 참고` 입력 → 미리보기에 red link 표시 → 저장 → `/s/eng/온보딩-가이드`로 이동, 렌더링 확인.
- red link "개발 환경" 클릭 → 제목이 미리 채워진 새 페이지 화면.
- 편집 → 본문 수정 → 저장 → 반영 확인.
- `bob`으로 `/s/notice/new` 접속 → `/denied` (organization 스페이스라 보이지만 editor 아님).
- `npm run build` → 성공.

- [ ] **Step 5: Commit**

```bash
git add src/actions/preview.ts src/components/MarkdownEditor.tsx src/app/s
git commit -m "feat: CodeMirror 마크다운 에디터 + 미리보기 + 생성/편집 화면"
```

---

### Task 13: 첨부파일 — 스토리지 + 업로드/다운로드 API

**Files:**
- Create: `src/lib/storage.ts`
- Create: `src/app/api/spaces/[spaceKey]/attachments/route.ts`, `src/app/api/attachments/[id]/route.ts`

**Interfaces:**
- Consumes: `getSessionInfo` (Task 7), `resolveSpaceRole`/`hasRole` (Task 4), `prisma` (Task 3)
- Produces:
  - `storage: StorageAdapter` — `put(key: string, data: Buffer): Promise<void>`, `get(key: string): Promise<Buffer>`. 로컬 디스크 구현(`ATTACHMENTS_DIR`), S3 교체 시 이 인터페이스만 재구현
  - `POST /api/spaces/{spaceKey}/attachments` (multipart, field `file`) → `{ id, url, filename }` — editor 권한, 20MB 제한
  - `GET /api/attachments/{id}` — 해당 스페이스 viewer 권한. 이미지(svg 제외)만 inline, 나머지는 attachment로 서빙

- [ ] **Step 1: src/lib/storage.ts 작성**

```ts
import { promises as fs } from "node:fs";
import path from "node:path";

export interface StorageAdapter {
  put(key: string, data: Buffer): Promise<void>;
  get(key: string): Promise<Buffer>;
}

const baseDir = () => process.env.ATTACHMENTS_DIR ?? "./data/attachments";

// key는 서버가 생성한 `${spaceId}/${uuid}` 형식만 사용 — 경로 조작 불가
export const storage: StorageAdapter = {
  async put(key, data) {
    const filePath = path.join(baseDir(), key);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, data);
  },
  async get(key) {
    return fs.readFile(path.join(baseDir(), key));
  },
};
```

- [ ] **Step 2: 업로드 API 작성**

`src/app/api/spaces/[spaceKey]/attachments/route.ts`:
```ts
import { NextRequest } from "next/server";
import { getSessionInfo } from "@/lib/access";
import { prisma } from "@/lib/db";
import { hasRole, resolveSpaceRole } from "@/lib/permissions";
import { storage } from "@/lib/storage";

const MAX_SIZE = 20 * 1024 * 1024;

export async function POST(req: NextRequest, ctx: { params: Promise<{ spaceKey: string }> }) {
  const { spaceKey } = await ctx.params;
  const session = await getSessionInfo();
  if (!session) return Response.json({ error: "로그인이 필요합니다." }, { status: 401 });

  const space = await prisma.space.findUnique({
    where: { key: spaceKey },
    include: { permissions: true },
  });
  if (!space) return Response.json({ error: "스페이스가 없습니다." }, { status: 404 });
  const role = resolveSpaceRole(session, space.visibility, space.permissions);
  if (role === null) return Response.json({ error: "스페이스가 없습니다." }, { status: 404 });
  if (!hasRole(role, "editor")) return Response.json({ error: "편집 권한이 필요합니다." }, { status: 403 });

  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) return Response.json({ error: "file 필드가 필요합니다." }, { status: 400 });
  if (file.size > MAX_SIZE) return Response.json({ error: "20MB 이하만 업로드할 수 있습니다." }, { status: 413 });

  const key = `${space.id}/${crypto.randomUUID()}`;
  await storage.put(key, Buffer.from(await file.arrayBuffer()));
  const att = await prisma.attachment.create({
    data: {
      spaceId: space.id,
      filename: file.name || "attachment",
      mime: file.type || "application/octet-stream",
      size: file.size,
      storageKey: key,
      uploaderId: session.userId,
    },
  });

  return Response.json({ id: att.id, url: `/api/attachments/${att.id}`, filename: att.filename });
}
```

- [ ] **Step 3: 다운로드 API 작성**

`src/app/api/attachments/[id]/route.ts`:
```ts
import { NextRequest } from "next/server";
import { getSessionInfo } from "@/lib/access";
import { prisma } from "@/lib/db";
import { hasRole, resolveSpaceRole } from "@/lib/permissions";
import { storage } from "@/lib/storage";

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const session = await getSessionInfo();
  if (!session) return new Response("로그인이 필요합니다.", { status: 401 });

  const att = await prisma.attachment.findUnique({
    where: { id },
    include: { space: { include: { permissions: true } } },
  });
  if (!att) return new Response("없습니다.", { status: 404 });
  const role = resolveSpaceRole(session, att.space.visibility, att.space.permissions);
  if (!hasRole(role, "viewer")) return new Response("없습니다.", { status: 404 });

  const data = await storage.get(att.storageKey);
  // SVG는 스크립트 실행이 가능하므로 inline 금지
  const inline = att.mime.startsWith("image/") && att.mime !== "image/svg+xml";
  return new Response(new Uint8Array(data), {
    headers: {
      "Content-Type": att.mime,
      "Content-Disposition": `${inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(att.filename)}`,
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, max-age=3600",
    },
  });
}
```

- [ ] **Step 4: 수동 검증**

`alice`로 로그인:
- `/s/eng/온보딩-가이드/edit`에서 클립보드 이미지 붙여넣기(스크린샷 캡처 후) → 본문에 `![...](/api/attachments/...)` 삽입, 미리보기에 이미지 표시 → 저장 → 보기 화면에서 이미지 렌더링.
- 로그아웃 상태에서 이미지 URL 직접 접속 → 401.
- `bob`으로 eng 스페이스 이미지 URL 접속 → 404.
- `npm run build` → 성공.

- [ ] **Step 5: Commit**

```bash
git add src/lib/storage.ts src/app/api
git commit -m "feat: 첨부파일 업로드/다운로드 - 스토리지 추상화 + 권한 검사"
```

---

### Task 14: 버전 이력 보기 + 복원

**Files:**
- Create: `src/app/s/[spaceKey]/[slug]/history/page.tsx`, `src/app/s/[spaceKey]/[slug]/history/[version]/page.tsx`

**Interfaces:**
- Consumes: `requireSpaceRole` (Task 7), `renderMarkdown` (Task 6), `restoreRevision` (Task 10), `ConfirmSubmitButton` (Task 11)
- Produces: `/s/{key}/{slug}/history` 이력 목록, `/s/{key}/{slug}/history/{version}` 버전 보기 + 복원 버튼(editor).

- [ ] **Step 1: 이력 목록 작성**

`src/app/s/[spaceKey]/[slug]/history/page.tsx`:
```tsx
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireSpaceRole } from "@/lib/access";
import { prisma } from "@/lib/db";

export default async function HistoryPage({ params }: { params: Promise<{ spaceKey: string; slug: string }> }) {
  const { spaceKey, slug: rawSlug } = await params;
  const slug = decodeURIComponent(rawSlug);
  const { space } = await requireSpaceRole(spaceKey, "viewer");
  const page = await prisma.page.findUnique({
    where: { spaceId_slug: { spaceId: space.id, slug } },
    include: { revisions: { orderBy: { version: "desc" } } },
  });
  if (!page) notFound();

  const authorIds = [...new Set(page.revisions.map((r) => r.authorId))];
  const authors = await prisma.user.findMany({ where: { id: { in: authorIds } } });
  const authorName = new Map(authors.map((u) => [u.id, u.name || u.email]));

  return (
    <main className="py-8">
      <h1 className="text-xl font-bold">
        <Link href={`/s/${spaceKey}/${encodeURIComponent(slug)}`} className="underline">{page.title}</Link>
        {" "}이력
      </h1>
      <ul className="mt-6 space-y-1 text-sm">
        {page.revisions.map((r) => (
          <li key={r.id} className="flex items-baseline gap-4 border-b border-gray-100 py-2">
            <Link
              href={`/s/${spaceKey}/${encodeURIComponent(slug)}/history/${r.version}`}
              className="text-blue-600 underline"
            >
              v{r.version}
            </Link>
            <span>{r.title}</span>
            <span className="ml-auto text-gray-400">
              {authorName.get(r.authorId) ?? r.authorId} · {r.createdAt.toISOString().slice(0, 16).replace("T", " ")}
            </span>
          </li>
        ))}
      </ul>
    </main>
  );
}
```

- [ ] **Step 2: 버전 보기 + 복원 작성**

`src/app/s/[spaceKey]/[slug]/history/[version]/page.tsx`:
```tsx
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireSpaceRole } from "@/lib/access";
import { prisma } from "@/lib/db";
import { hasRole } from "@/lib/permissions";
import { renderMarkdown } from "@/lib/markdown";
import { restoreRevision } from "@/actions/pages";
import { ConfirmSubmitButton } from "@/components/ConfirmSubmitButton";

export default async function RevisionPage({
  params,
}: {
  params: Promise<{ spaceKey: string; slug: string; version: string }>;
}) {
  const { spaceKey, slug: rawSlug, version: versionStr } = await params;
  const slug = decodeURIComponent(rawSlug);
  const version = Number(versionStr);
  if (!Number.isInteger(version) || version < 1) notFound();

  const { space, role } = await requireSpaceRole(spaceKey, "viewer");
  const page = await prisma.page.findUnique({
    where: { spaceId_slug: { spaceId: space.id, slug } },
  });
  if (!page) notFound();
  const rev = await prisma.pageRevision.findUnique({
    where: { pageId_version: { pageId: page.id, version } },
  });
  if (!rev) notFound();

  const latest = await prisma.pageRevision.aggregate({ where: { pageId: page.id }, _max: { version: true } });
  const isLatest = latest._max.version === version;
  const html = await renderMarkdown(rev.content, { spaceKey, existingSlugs: new Set() });

  return (
    <main className="py-8">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">
          {rev.title} <span className="text-gray-400">v{version}{isLatest && " (최신)"}</span>
        </h1>
        <div className="flex gap-2 text-sm">
          <Link href={`/s/${spaceKey}/${encodeURIComponent(slug)}/history`} className="rounded border border-gray-300 px-3 py-1.5">
            이력으로
          </Link>
          {hasRole(role, "editor") && !isLatest && (
            <form action={restoreRevision.bind(null, spaceKey, slug, version)}>
              <ConfirmSubmitButton message={`v${version} 내용으로 복원할까요? (새 버전으로 저장됩니다)`} className="rounded bg-blue-600 px-3 py-1.5 text-white">
                이 버전으로 복원
              </ConfirmSubmitButton>
            </form>
          )}
        </div>
      </div>
      <article className="prose-wiki mt-6" dangerouslySetInnerHTML={{ __html: html }} />
    </main>
  );
}
```

참고: 과거 버전 보기는 위키링크 존재 여부 판별이 중요하지 않아 `existingSlugs: new Set()`로 모두 red link 처리한다(복원 시 최신 화면에서 정상 판별).

- [ ] **Step 3: 수동 검증**

`alice`로 로그인, `/s/eng/온보딩-가이드`를 2회 이상 편집한 상태에서:
- 이력 → v1, v2, ... 목록 표시.
- v1 열기 → 당시 내용 렌더링, "이 버전으로 복원" 버튼.
- 복원 → 페이지 내용이 v1과 같아지고 이력에 새 버전 추가.
- `npm run build` → 성공.

- [ ] **Step 4: Commit**

```bash
git add src/app/s
git commit -m "feat: 페이지 버전 이력 보기 + 복원"
```

---

### Task 15: 전문 검색

**Files:**
- Create: `src/lib/search.ts`, `src/app/search/page.tsx`

**Interfaces:**
- Consumes: `requireSession`/`listReadableSpaces` (Task 7), `prisma` (Task 3), Task 3의 `searchVector` GENERATED 컬럼/GIN 인덱스
- Produces: `searchPages(q: string, readableSpaceIds: string[]): Promise<SearchResult[]>`,
  `interface SearchResult { spaceKey: string; spaceName: string; slug: string; title: string; snippet: string }`.
  스니펫은 `[[HL]]...[[/HL]]` 마커 — 렌더 측에서 이스케이프 후 `<mark>`로 변환(원문 HTML 주입 방지).

- [ ] **Step 1: src/lib/search.ts 작성**

```ts
import { prisma } from "@/lib/db";

export interface SearchResult {
  spaceKey: string;
  spaceName: string;
  slug: string;
  title: string;
  snippet: string;
}

export async function searchPages(q: string, readableSpaceIds: string[]): Promise<SearchResult[]> {
  const query = q.trim();
  if (!query || readableSpaceIds.length === 0) return [];
  return prisma.$queryRaw<SearchResult[]>`
    SELECT
      s."key"  AS "spaceKey",
      s."name" AS "spaceName",
      p."slug",
      p."title",
      ts_headline(
        'simple', p."content", websearch_to_tsquery('simple', ${query}),
        'StartSel=[[HL]],StopSel=[[/HL]],MaxWords=30,MinWords=10'
      ) AS "snippet"
    FROM "Page" p
    JOIN "Space" s ON s."id" = p."spaceId"
    WHERE p."spaceId" = ANY(${readableSpaceIds})
      AND (
        p."searchVector" @@ websearch_to_tsquery('simple', ${query})
        OR p."title" ILIKE '%' || ${query} || '%'
      )
    ORDER BY ts_rank(p."searchVector", websearch_to_tsquery('simple', ${query})) DESC
    LIMIT 50
  `;
}
```

- [ ] **Step 2: 검색 페이지 작성**

`src/app/search/page.tsx`:
```tsx
import Link from "next/link";
import { listReadableSpaces, requireSession } from "@/lib/access";
import { searchPages } from "@/lib/search";

function Snippet({ text }: { text: string }) {
  // [[HL]]마커[[/HL]] → <mark>. 원문은 React가 이스케이프하므로 안전.
  const parts = text.split(/\[\[HL\]\]|\[\[\/HL\]\]/);
  return (
    <p className="mt-1 text-sm text-gray-600">
      {parts.map((part, i) => (i % 2 === 1 ? <mark key={i}>{part}</mark> : <span key={i}>{part}</span>))}
    </p>
  );
}

export default async function SearchPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const { q } = await searchParams;
  const session = await requireSession();
  const spaces = await listReadableSpaces(session);
  const results = q ? await searchPages(q, spaces.map((s) => s.id)) : [];

  return (
    <main className="py-8">
      <h1 className="text-2xl font-bold">검색{q ? `: ${q}` : ""}</h1>
      <ul className="mt-6 space-y-4">
        {results.map((r) => (
          <li key={`${r.spaceKey}/${r.slug}`}>
            <span className="text-xs text-gray-400">{r.spaceName}</span>
            <div>
              <Link href={`/s/${r.spaceKey}/${encodeURIComponent(r.slug)}`} className="font-semibold text-blue-600 underline">
                {r.title}
              </Link>
            </div>
            <Snippet text={r.snippet} />
          </li>
        ))}
        {q && results.length === 0 && <li className="text-gray-500">결과가 없습니다.</li>}
        {!q && <li className="text-gray-500">헤더의 검색창에 검색어를 입력하세요.</li>}
      </ul>
    </main>
  );
}
```

- [ ] **Step 3: 수동 검증**

- `alice`로 "온보딩" 검색 → eng 스페이스 결과 표시, 매칭 단어 하이라이트.
- `bob`으로 같은 검색 → eng 결과가 보이지 않음 (notice만 검색됨).
- `npm run build` → 성공.

- [ ] **Step 4: Commit**

```bash
git add src/lib/search.ts src/app/search
git commit -m "feat: PostgreSQL FTS 검색 + 권한 필터링"
```

---

### Task 16: Playwright e2e — 핵심 플로우

**Files:**
- Create: `playwright.config.ts`, `e2e/helpers.ts`, `e2e/wiki.spec.ts`

**Interfaces:**
- Consumes: 실행 중인 docker compose(Postgres+Keycloak, Task 2), 시드 데이터(Task 3), 전체 앱.
- 전제: `docker compose up -d && npm run db:migrate && npm run db:seed` 완료 상태에서 실행. dev 서버는 Playwright webServer가 띄운다.

- [ ] **Step 1: playwright.config.ts 작성**

```ts
import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  workers: 1,
  use: {
    baseURL: "http://localhost:3000",
  },
  webServer: {
    command: "npm run dev",
    url: "http://localhost:3000",
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
```

Run: `npx playwright install chromium` (최초 1회)

- [ ] **Step 2: 로그인 헬퍼 작성**

`e2e/helpers.ts`:
```ts
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
```

- [ ] **Step 3: e2e 시나리오 작성**

`e2e/wiki.spec.ts`:
```ts
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
  await expect(page.getByText("권한이 없습니다")).toBeVisible();
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
```

- [ ] **Step 4: 실행 및 통과 확인**

Run: `docker compose up -d && npm run db:seed && npm run e2e`
Expected: 3 passed.

주의: e2e는 DB에 데이터를 남긴다(E2E 온보딩, e2e-docs). 재실행 시 `createPage`의 중복 slug 처리(편집 화면으로 redirect) 때문에 첫 테스트가 깨질 수 있으므로, 반복 실행 전 `docker compose down -v && docker compose up -d && npm run db:migrate && npm run db:seed`로 초기화한다.

- [ ] **Step 5: Commit**

```bash
git add playwright.config.ts e2e
git commit -m "test: Playwright e2e - 로그인/페이지 CRUD/이력/검색/권한 차단"
```

---

### Task 17: Dockerfile + README

**Files:**
- Create: `Dockerfile`, `.dockerignore`
- Modify: `README.md`

**Interfaces:**
- Consumes: `next.config.ts`의 `output: "standalone"` (Task 1)

- [ ] **Step 1: Dockerfile 작성**

```dockerfile
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json prisma ./
RUN npm ci

FROM node:22-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npx prisma generate && npm run build

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/node_modules/prisma ./node_modules/prisma
COPY --from=builder /app/node_modules/@prisma ./node_modules/@prisma
EXPOSE 3000
CMD ["node", "server.js"]
```

`.dockerignore`:
```
node_modules
.next
.git
.env
data
docs
e2e
tests
```

- [ ] **Step 2: README.md 교체**

```markdown
# simple-wiki

마크다운 기반 조직용 위키. Keycloak 인증 + 스페이스 단위 권한 관리.

## 개발 환경 시작

​```bash
docker compose up -d          # PostgreSQL + Keycloak (realm 자동 임포트)
cp .env.example .env
npm install
npm run db:migrate            # 스키마 적용
npm run db:seed               # 예시 스페이스 생성
npm run dev                   # http://localhost:3000
​```

### 테스트 계정 (dev Keycloak)

| 계정 | 비밀번호 | 권한 |
|---|---|---|
| wiki-admin | admin1234 | 전역 관리자 (realm 역할 wiki-admin) |
| alice | alice1234 | /engineering 그룹 → eng 스페이스 editor |
| bob | bob1234 | 그룹 없음 |

Keycloak 관리 콘솔: http://localhost:8080 (admin/admin)

## 권한 모델

- 전역 관리자: Keycloak realm 역할 `wiki-admin` — 스페이스 생성/삭제, 모든 스페이스 관리
- 스페이스 역할: `viewer` < `editor` < `admin` — Keycloak 그룹 또는 개별 사용자에게 부여
- 공개 범위: `organization`(로그인 사용자 모두 읽기) / `restricted`(권한 부여 대상만)

## 테스트

​```bash
npm test        # Vitest 단위 테스트
npm run e2e     # Playwright (docker compose + seed 필요)
​```

## 운영 배포

- `Dockerfile`로 앱 이미지 빌드. `DATABASE_URL`, `AUTH_*` 환경 변수를 운영 값으로 주입
- 운영 Keycloak realm에 client 등록 후 `AUTH_KEYCLOAK_ISSUER` 교체
- 마이그레이션: `npx prisma migrate deploy`
- 첨부파일 볼륨: `ATTACHMENTS_DIR` 경로를 퍼시스턴트 볼륨으로 마운트
​```

(README의 ​``` 는 실제 파일에서는 일반 코드펜스로 작성)

- [ ] **Step 3: 빌드 검증**

Run: `docker build -t simple-wiki .`
Expected: 이미지 빌드 성공.

- [ ] **Step 4: Commit**

```bash
git add Dockerfile .dockerignore README.md
git commit -m "chore: 운영용 Dockerfile + README 개발 가이드"
```

---

## 검증 (전체)

1. `npm test` — 단위 테스트 전부 통과 (slug, permissions, wiki-links, markdown).
2. `docker compose down -v && docker compose up -d && npm run db:migrate && npm run db:seed && npm run e2e` — e2e 3개 통과.
3. 수동: alice/bob/wiki-admin 각각 로그인해 Task 8~15의 수동 검증 항목 재확인.
4. `npm run build` + `docker build` 성공.
