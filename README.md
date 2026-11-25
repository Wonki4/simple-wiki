# simple-wiki

마크다운 기반 조직용 위키. **Keycloak OIDC 인증**, **스페이스 단위 권한**, **라이브 마크다운 에디터**,
**권한 범위 전문검색**, **버전 이력**, **좋아요·댓글**, 그리고 **LLM이 API/MCP로 문서를 읽고 쓸 수 있는** 위키입니다.

## 주요 기능

- **스페이스 + 권한** — 문서를 스페이스로 묶고, `viewer < editor < admin` 3단계 권한을 위키 그룹/개별 사용자에게 부여. 스페이스는 전체 공개(organization) 또는 제한(restricted).
- **라이브 마크다운 편집** — 클릭한 줄은 마크다운 원문으로 편집하고, 다른 줄은 제목·강조·링크 등 서식으로 표시합니다. 표·코드·이미지는 클릭하면 원문이 펼쳐집니다. 모드 전환이나 별도 미리보기 없이 한 화면에서 편집합니다. 편집하지 않은 공백과 줄바꿈은 그대로 저장됩니다. 현재 문서와 이전 버전의 원문은 **더보기 → 원문 보기**에서 확인하고 복사할 수 있습니다.
- **전문 검색** — PostgreSQL `tsvector` + `pg_trgm`으로 읽을 수 있는 스페이스를 검색합니다. 검색어가 제목 전체와 일치하는 문서가 맨 위에 나오고, 대소문자만 다른 제목이 그 뒤를 잇습니다. 나머지는 관련도순입니다. 스페이스 안의 헤더 검색창(`⌘K`)은 해당 스페이스에서 시작합니다. 결과 화면에서 범위를 바꾸고 20건씩 이동합니다.
- **마크다운 문법** — 제목 1~6, 강조·취소선, 일반·참조·자동 링크, 이미지, 중첩 목록·체크박스, 인용, 표 정렬, 인라인·블록 코드와 각주를 지원합니다. 언어를 지정한 코드 블록은 읽기 화면과 같은 색상으로 강조됩니다. 읽기·과거 버전·라이브 편집 화면의 코드 블록에서 코드만 복사할 수 있습니다. 라이브에서 링크를 클릭하면 편집하고, Ctrl/Cmd+클릭하면 주소를 엽니다. 수식과 Mermaid 도표 렌더링은 지원하지 않으며 원문·코드로 보존합니다.
- **버전 이력** — 저장할 때마다 리비전 스냅샷. 이전 버전 보기·복원 및 두 버전의 제목·마크다운 줄 단위 비교.
- **문서 휴지통** — 스페이스 편집자는 삭제한 문서를 이력·댓글·좋아요와 함께 복원할 수 있습니다. 하위 문서는 가까운 상위 문서에 계속 표시되고, 원래 주소를 다른 문서가 사용하면 복원 주소를 선택할 수 있습니다.
- **위키링크** — `[[문서]]`, `[[문서#소제목]]`, `[[#소제목]]`, `[[eng:문서#소제목|표시할 이름]]`을 지원합니다. 라이브 편집기에서 `[[`로 같은 스페이스 문서를, `[[eng:`로 읽을 수 있는 다른 스페이스 문서를, `#` 뒤에서 소제목을 선택합니다. 같은 이름의 두 번째 소제목은 자동완성에서 `소제목-2`로 구분합니다. 문서 하단의 **이 페이지를 링크한 문서**에는 위키링크나 일반 마크다운 링크로 현재 문서를 연결한 다른 문서가 표시됩니다. 읽을 수 있는 문서만 원본별로 한 번씩 나타납니다. 스페이스 홈의 **깨진 위키링크**에서 현재 본문에 남은 누락 문서·소제목을 원본 문서별로 확인하고 수정할 수 있습니다.
- **문서 읽기** — 소제목이 둘 이상이면 넓은 화면에서는 오른쪽 고정 목차, 좁은 화면에서는 제목 아래 목차 메뉴를 제공. 백링크는 기본 5개를 표시하며, 나머지는 높이가 제한된 목록으로 펼쳐 확인할 수 있음. 소제목 옆 `#`으로 해당 절의 주소를 복사하고, 본문 이미지를 눌러 원본을 새 탭에서 열 수 있음.
- 스페이스 홈의 **고아 문서**에는 열람 가능한 다른 문서의 현재 본문에서 위키링크나 마크다운 링크를 받지 않은 문서가 표시됩니다. 자기 링크와 휴지통에 있는 문서는 집계에서 제외합니다.
- **첨부파일** — 이미지 붙여넣기·드래그와 파일 첨부를 지원합니다. 여러 파일 중 일부가 실패하면 편집기에 파일명과 원인을 표시하고, 실패한 파일만 다시 올릴 수 있습니다. 스페이스 권한으로 접근 통제, SVG는 첨부(attachment)로 강제 다운로드.
- 스페이스 홈의 **첨부파일**에서 파일 이름으로 검색하고 그 파일을 사용하는 문서로 이동할 수 있습니다. 사용처는 같은 스페이스에 있는 문서의 현재 본문을 기준으로 표시합니다.
- **좋아요 · 마이페이지 · 댓글** — 페이지 좋아요(하트), 마이페이지(`/me`)에서 좋아요한 글 목록, 페이지 하단 댓글.
- **작성자 · 프로필 이미지** — 문서 제목 아래에 최초 작성자와 마지막 수정 시각을 표시합니다. 작성자·댓글·계정 메뉴의 사진은 Keycloak에서 연동하며, 사진이 없거나 로드에 실패하면 이름 첫 글자로 표시합니다.
- **LLM/API 편집 표시** — 개인 액세스 토큰(봇)으로 만든/수정한 문서는 문서 상단·이력에 `🤖 토큰이름` 뱃지.
- **HTML Viewer** — 모든 문서에서 열 수 있습니다. 저장된 HTML이 없으면 위키 MCP에 연결한 에이전트에게 어떻게 요청할지 안내합니다. 에이전트는 `get_page`로 원문을 읽고 HTML과 CSS를 작성한 뒤 `save_page_html`로 저장합니다. 마크다운과 편집 이력은 유지되며, 원문이 바뀌면 HTML Viewer에 기준 버전과 현재 버전이 함께 표시됩니다.
- **스페이스 타임라인** — 스페이스의 **타임라인** 탭에서 기간별 논의·결정과 문서·댓글 이력을 살펴봅니다. 위키 MCP에 연결된 에이전트가 `save_page_timeline`으로 근거가 있는 항목을 기록하며, 각 기록을 원문 버전에서 확인할 수 있습니다.
- **API · 개인 액세스 토큰(PAT) · MCP 서버** — LLM이 위키를 읽고(검색/조회) 쓸(생성/수정) 수 있음. → [`mcp-server/`](mcp-server/README.md)

## 기술 스택

| 영역 | 사용 |
|---|---|
| 앱 | Next.js 15 (App Router, RSC, Server Actions), React 19, TypeScript |
| DB | PostgreSQL 16, Prisma 6 (생성 tsvector 컬럼, pg_trgm) |
| 인증 | Auth.js (next-auth v5) + Keycloak OIDC |
| 에디터 | CodeMirror 6 · 라이브 마크다운 |
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
| `bob` | `bob1234` | 그룹 없음 (전체 공개 스페이스만 열람) |

Keycloak 관리 콘솔: http://localhost:8080 (admin/admin)

### Keycloak 프로필 이미지

위키에 별도 사진 업로드 기능은 없으며, 로그인할 때 OIDC `picture` 클레임을 사용자 DB와 세션에 저장합니다. 사진 변경·삭제는 다음 로그인 때 반영됩니다. 문서 작성자는 최초 작성자를 유지합니다.

- Keycloak의 **Realm Settings → User profile**에 선택 항목 `picture`를 등록하고, 사용자의 속성에 이미지 URL을 입력합니다. 외부 IdP를 쓰면 그 IdP의 사진을 같은 속성으로 매핑합니다.
- 위키 클라이언트에 연결된 `profile` 스코프의 mapper가 `picture`를 **ID token**에 포함하는지 확인합니다. 없으면 **User Attribute** mapper를 추가합니다: `User Attribute=picture`, `Token Claim Name=picture`, `Claim JSON Type=String`, `Add to ID token=On`. UserInfo도 사용하면 해당 옵션을 켭니다.
- URL은 브라우저에서 직접 열 수 있는 `https://` 이미지 주소를 권장합니다(로컬·사내 HTTP 환경도 지원). 별도 Bearer 헤더가 필요한 이미지 API는 사용할 수 없습니다. Keycloak 속성 검증으로 조직이 관리하는 이미지 호스트만 허용할 수 있습니다. 위키는 이미지 요청에 문서 주소를 Referer로 보내지 않으며 서버에서 이미지를 프록시하지 않습니다.
- 기존 DB에는 `npx prisma migrate deploy`로 `User.imageUrl` 컬럼을 추가합니다. 기존 사용자는 다음 로그인 전까지 이름 첫 글자가 표시됩니다.

설정 참고: [Keycloak의 프로필 이미지 문서](https://www.keycloak.org/ui-customization/avatars).

## 권한 모델

- **전역 관리자**: Keycloak realm 역할 `wiki-admin` 또는 `WIKI_ADMIN_GROUP`으로 지정한 그룹 소속 — 스페이스 생성/삭제, 모든 스페이스 관리.
- **스페이스 역할**: `viewer` < `editor` < `admin` — 위키 그룹 또는 개별 사용자에게 부여. 스페이스 설정에서 이름·아이디·이메일·그룹명을 한 번에 검색하고 대상을 선택합니다. 기존 대상은 선택한 역할로 변경되며, 사용자는 한 번 이상 로그인해야 검색됩니다.
- **공개 범위**: `organization`(로그인 사용자 모두 읽기) / `restricted`(권한 부여 대상만; 미부여자에겐 존재 자체를 404로 숨김).
- **권한 대상 검색**: 정확 일치·접두 일치 우선, 세 글자 이상은 부분 검색도 지원합니다. [1,000만 사용자 부하 테스트 결과](docs/performance/2026-11-22-permission-search-10m.md).
- 위키 그룹 멤버십과 스페이스 권한 변경은 다음 요청부터 반영됩니다. Keycloak의 전역 관리자 여부는 로그인 시점에 반영됩니다.

## API · MCP (LLM 연동)

- **개인 액세스 토큰(PAT)**: `/settings/tokens`에서 발급(`swk_...`). 발급자 권한 안에서 읽기 전용 또는 읽기·쓰기를 선택하고, 전체 또는 스페이스 하나로 제한할 수 있습니다. 기존 토큰은 이전과 같은 범위로 동작합니다.
- **REST API**: `Authorization: Bearer swk_...`
  - `GET /api/spaces` · `GET /api/spaces/{key}/pages` · `GET /api/spaces/{key}/pages/{slug}`
  - `POST /api/spaces/{key}/pages` · `PUT .../{slug}` · `DELETE .../{slug}` (editor)
  - `PUT /api/spaces/{key}/pages/{slug}/html` (editor) — `{ "baseVersion": 3, "html": "<h1>보고서</h1>" }`. HTML은 UTF-8 기준 최대 512 KiB입니다. 최신 원문 버전과 다르면 409를 반환합니다. 성공하면 HTML을 저장하고 `baseVersion`과 HTML Viewer 주소인 `previewUrl`을 반환합니다. 같은 문서에 다시 저장하면 이전 HTML을 교체합니다. 링크를 열려면 문서 열람 권한이 필요합니다.
  - `GET /api/search?q=배포&space=eng&page=2` — `space` 생략 시 읽을 수 있는 전체 스페이스. 페이지당 50건이며 `results`와 함께 `page`, `pageSize`, `total`, `totalPages`를 반환합니다. 범위를 넘긴 페이지는 마지막 페이지로 맞춥니다.
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
  components/     # MarkdownEditor(CodeMirror), Sidebar, LikeButton, CommentForm 등
prisma/           # schema.prisma + migrations (생성 tsvector 컬럼)
mcp-server/       # MCP 서버 (stdio + streamable-http)
deploy/           # docker-compose.prod.yml, Helm 차트
keycloak/         # realm-export.json (dev 시드)
```
