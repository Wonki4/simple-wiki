# simple-wiki

마크다운 기반 조직용 위키. **Keycloak OIDC 인증**, **스페이스 단위 권한**, **노션식 블록 에디터**,
**권한 범위 전문검색**, **버전 이력**, **좋아요·댓글**, 그리고 **LLM이 API/MCP로 문서를 읽고 쓸 수 있는** 위키입니다.

## 주요 기능

- **스페이스 + 권한** — 문서를 스페이스로 묶고, `viewer < editor < admin` 3단계 권한을 Keycloak 그룹/개별 사용자에게 부여. 스페이스는 전사 공개(organization) 또는 제한(restricted).
- **노션식 블록 에디터** — [Milkdown](https://milkdown.dev) 기반. `#`·`-` 마크다운 즉시 변환, `/` 슬래시 메뉴, 블록 핸들. 저장은 마크다운 원문.
- **전문 검색** — PostgreSQL `tsvector` + `pg_trgm`. **읽을 수 있는 스페이스만** 검색됨(권한 격리). 헤더 검색창(`⌘K`).
- **버전 이력** — 저장할 때마다 리비전 스냅샷. 이전 버전 보기·복원.
- **위키링크 `[[페이지명]]`** — 자동 링크, 백링크(이 페이지를 링크한 문서), 없는 문서는 red link.
- **첨부파일** — 이미지 붙여넣기/드래그 업로드. 스페이스 권한으로 접근 통제, SVG는 첨부(attachment)로 강제 다운로드.
- **좋아요 · 마이페이지 · 댓글** — 페이지 좋아요(하트), 마이페이지(`/me`)에서 좋아요한 글 목록, 페이지 하단 댓글.
- **LLM/API 편집 표시** — 개인 액세스 토큰(봇)으로 만든/수정한 문서는 문서 상단·이력에 `🤖 토큰이름` 뱃지.
- **API · 개인 액세스 토큰(PAT) · MCP 서버** — LLM이 위키를 읽고(검색/조회) 쓸(생성/수정) 수 있음. → [`mcp-server/`](mcp-server/README.md)

## 기술 스택

| 영역 | 사용 |
|---|---|
| 앱 | Next.js 15 (App Router, RSC, Server Actions), React 19, TypeScript |
| DB | PostgreSQL 16, Prisma 6 (생성 tsvector 컬럼, pg_trgm) |
| 인증 | Auth.js (next-auth v5) + Keycloak OIDC |
| 에디터 | Milkdown (Crepe) |
| 렌더링 | unified · remark · rehype · rehype-sanitize · shiki(듀얼 테마) |
| 스타일 | Tailwind CSS v4 + CSS 디자인 토큰, IBM Plex Mono |
| LLM 연동 | Model Context Protocol SDK (stdio + streamable-http) |
| 테스트 | Vitest(단위), Playwright(e2e) |

## 빠른 시작 (개발)

```bash
docker compose up -d          # PostgreSQL(5433) + Keycloak(8080, realm 자동 임포트)
cp .env.example .env
npm install
npm run db:migrate            # 스키마 적용 (prisma migrate dev)
npm run db:seed               # 예시 스페이스·문서 생성
npm run dev                   # http://localhost:3000
```

> PostgreSQL은 호스트 **5433** 포트를 씁니다(기본 5432 충돌 회피 — `.env.example` 참고).

### 테스트 계정 (dev Keycloak)

| 계정 | 비밀번호 | 권한 |
|---|---|---|
| `wiki-admin` | `admin1234` | 전역 관리자 (realm 역할 `wiki-admin`) — 스페이스 생성/삭제, 전체 관리 |
| `alice` | `alice1234` | `/engineering` 그룹 → `eng` 스페이스 editor |
| `bob` | `bob1234` | 그룹 없음 (전사 공개 스페이스만 열람) |

Keycloak 관리 콘솔: http://localhost:8080 (admin/admin)

## 권한 모델

- **전역 관리자**: Keycloak realm 역할 `wiki-admin` 또는 `WIKI_ADMIN_GROUP`으로 지정한 그룹 소속 — 스페이스 생성/삭제, 모든 스페이스 관리.
- **스페이스 역할**: `viewer` < `editor` < `admin` — Keycloak 그룹 또는 개별 사용자에게 부여.
- **공개 범위**: `organization`(로그인 사용자 모두 읽기) / `restricted`(권한 부여 대상만; 미부여자에겐 존재 자체를 404로 숨김).
- 권한은 **로그인 시점의 Keycloak 클레임을 스냅샷**해 판정합니다. 그룹/역할 변경은 재로그인 시 반영됩니다.

## API · MCP (LLM 연동)

- **개인 액세스 토큰(PAT)**: `/settings/tokens`에서 발급(`swk_...`). 토큰 소유자의 스페이스 권한을 그대로 상속.
- **REST API**: `Authorization: Bearer swk_...`
  - `GET /api/spaces` · `GET /api/spaces/{key}/pages` · `GET /api/spaces/{key}/pages/{slug}`
  - `POST /api/spaces/{key}/pages` · `PUT .../{slug}` · `DELETE .../{slug}` (editor)
  - `GET /api/search?q=` (읽을 수 있는 스페이스만)
- **MCP 서버**: `list_spaces`·`list_pages`·`search_pages`·`get_page`·`create_page`·`update_page`·`delete_page` 도구 제공.
  로컬(stdio) / 원격(streamable-http) 모두 지원. 설치·등록은 [`mcp-server/README.md`](mcp-server/README.md).

## 테스트

```bash
npm test        # Vitest 단위 테스트
npm run e2e     # Playwright (docker compose + seed 필요)
```

> e2e 테스트는 고정 이름의 데이터를 만들고 정리하지 않으므로, 재실행 전 DB를 초기화하는 것이 안전합니다:
> ```bash
> docker compose down -v && docker compose up -d
> npx prisma migrate deploy && npm run db:seed
> ```

## 배포

- **docker-compose 올인원**(앱+DB+Keycloak+MCP) 또는 **Helm 차트**(k8s, 외부 DB·Keycloak). → [`deploy/README.md`](deploy/README.md)
- 마이그레이션은 `npx prisma migrate deploy`(compose는 `migrate` 서비스, Helm은 initContainer가 자동 실행).
- 첨부파일은 디스크 저장(`ATTACHMENTS_DIR`) — 퍼시스턴트 볼륨 필요. 다중 레플리카는 RWX 볼륨 필요.
- 업로드 크기는 앱의 사전 검사가 best-effort이므로 리버스 프록시에서 제한 권장(예: nginx `client_max_body_size 21m`).

## 환경 변수 (`.env.example`)

| 변수 | 설명 |
|---|---|
| `DATABASE_URL` | PostgreSQL 접속 (dev: `...@localhost:5433/wiki`) |
| `AUTH_SECRET` | Auth.js 시크릿 (`openssl rand -base64 32`) |
| `AUTH_URL` | 앱 공개 URL |
| `AUTH_KEYCLOAK_ID` / `AUTH_KEYCLOAK_SECRET` | Keycloak client(`simple-wiki-app`)와 시크릿 |
| `AUTH_KEYCLOAK_ISSUER` | `{keycloak}/realms/simple-wiki` |
| `WIKI_ADMIN_GROUP` | (선택) 이 그룹(전체 경로, 예 `/wiki-admins`) 소속도 전역 관리자로 판정 |
| `ATTACHMENTS_DIR` | 첨부파일 저장 경로 (기본 `./data/attachments`) |

## 프로젝트 구조

```
src/
  app/            # 라우트 (스페이스/문서/검색/마이페이지/설정, API route handlers)
  actions/        # 서버 액션 (pages, spaces, likes, comments, tokens)
  lib/            # permissions, access, pages, search, likes, comments, markdown, api-auth
  components/     # MarkdownEditor(Milkdown), Sidebar, LikeButton, CommentForm 등
prisma/           # schema.prisma + migrations (생성 tsvector 컬럼)
mcp-server/       # MCP 서버 (stdio + streamable-http)
deploy/           # docker-compose.prod.yml, Helm 차트
keycloak/         # realm-export.json (dev 시드)
```
