# simple-wiki MCP 협업 3종 설계

**작성일:** 2026-07-13
**대상 브랜치:** feat/wiki-v1
**목표:** MCP를 통해 LLM이 사람과 나란히 위키를 편집할 때 안전하고 편안하도록, 세 가지 협업 기능을 기존 코드베이스 위에 얹는다.

## 배경 / 문제

현재 MCP 서버는 7개 도구(list_spaces, list_pages, search_pages, get_page, create_page, update_page, delete_page)를 노출한다. 읽기용으로는 충분하지만 "사람과 함께 편집"하는 용도로는 세 가지가 비어 있다.

1. **동시성 가드 부재** — `update_page`는 `{title, content}`만 받아 본문을 통째로 덮어쓴다. `get_page` → (사이에 사람이 편집) → `update_page` 순서면 사람 수정분이 조용히 사라진다. 낙관적 잠금이 없다.
2. **이력·되돌리기 미노출** — 플랫폼에 `PageRevision`과 히스토리 화면이 있으나 API·MCP로 노출되지 않는다. LLM이 무엇이 바뀌었는지 못 보고, 잘못 덮었을 때 되돌릴 수단도 없다.
3. **부분 편집 불가** — 전체 교체만 가능해, 한 줄 수정에도 문서 전체를 재작성해야 한다(토큰 낭비 + 재작성 중 내용 유실 위험).

## 핵심 토대: 버전 토큰

세 기능 모두 `PageRevision.version`(페이지별 단조 증가, 기존 `@@unique([pageId, version])`)을 동시성 토큰이자 이력 축으로 사용한다.

**스키마 변경(1개):** `Page`에 `version Int @default(1)` 컬럼 추가.

- 매 저장 시 새 리비전 번호 = `page.version + 1`을 쓰고, `Page.version`도 그 값으로 갱신한다. `Page.version`은 항상 최신 리비전의 version과 같다.
- 클라이언트(MCP/웹)는 이 값을 읽어 쓰기 요청 시 `expectedVersion`으로 되돌려준다.
- 동시 쓰기 경합의 최종 안전망은 기존 `@@unique([pageId, version])` 제약이다. 두 편집이 같은 다음 번호로 리비전을 만들려 하면 하나는 unique 위반(Prisma P2002)으로 실패하고, 이를 충돌로 번역한다.

**마이그레이션 절차:**
1. `Page.version` 컬럼 추가(default 1).
2. 기존 페이지 백필: 페이지마다 `version = (해당 페이지의 max PageRevision.version)`. 모든 페이지는 리비전이 최소 1개 있으므로 항상 값이 있다.
3. 생성되는 마이그레이션 SQL에서 stray `ALTER TABLE "Page" ALTER COLUMN "searchVector" DROP DEFAULT;` 줄을 반드시 제거한 뒤 적용한다(기존 프로젝트 규칙).

## 기능 ①: 낙관적 잠금

### lib 계층 (`src/lib/pages.ts`)

- `updatePageInSpace` 입력에 `expectedVersion?: number` 추가.
- 쓰기를 트랜잭션 안에서 수행: 트랜잭션 내에서 페이지를 읽어 `expectedVersion`이 주어졌고 `page.version !== expectedVersion`이면 `PageConflictError`를 던진다.
- 새 리비전 version = `page.version + 1`, `Page.version`도 갱신. `nextVersion` 집계 대신 `page.version + 1` 사용.
- 리비전 생성 시 P2002(unique 위반 on `pageId, version`)가 나면 같은 `PageConflictError`로 번역한다.

**에러 타입:**

```ts
export class PageConflictError extends Error {
  currentVersion: number;
  constructor(currentVersion: number) {
    super("페이지가 그사이 변경되었습니다.");
    this.name = "PageConflictError";
    this.currentVersion = currentVersion;
  }
}
```

`expectedVersion`이 **없으면** 기존 동작(last-write-wins)을 유지한다. 단, 트랜잭션 내 read-modify-write로 연산 자체는 원자적이며, 경합은 unique 제약이 막는다.

### API 계층

- `GET /api/spaces/[spaceKey]/pages/[slug]` 응답에 `version` 필드 추가.
- `PUT /api/spaces/[spaceKey]/pages/[slug]`: body의 `expectedVersion`(선택) 파싱 후 전달. `PageConflictError` → HTTP **409** `{ error, currentVersion }`.

### MCP 계층 (`mcp-server/src/tools.ts`)

- `get_page` 출력에 `version` 포함(API가 반환하므로 그대로 전달).
- `update_page`에 `expectedVersion?` 입력 추가. 409 응답이면 isError로 "충돌: 현재 버전은 N입니다. get_page로 다시 읽고 병합 후 재시도하세요" 안내.
- `SERVER_INSTRUCTIONS` 갱신: "get_page의 version을 기억했다가 update/append/replace/revert 시 expectedVersion으로 넘겨라. 409면 get_page로 다시 읽고 병합 후 재시도."

### 웹 에디터 (양방향 보호)

- 편집 페이지 로드 시 서버 컴포넌트가 `version`을 클라이언트 에디터로 전달.
- 저장 서버액션(`src/actions/pages.ts`)이 `expectedVersion`을 함께 전송.
- `PageConflictError`면 서버액션이 충돌 상태를 반환하고, 에디터가 **"다른 사람이 먼저 수정했습니다 — 최신 내용을 불러온 뒤 다시 저장하세요"**를 표시하며 최신 불러오기 동선을 제공한다. 입력 중이던 draft는 유지한다.
- 3-way 병합은 하지 않는다(저장 차단 + 안내 + 재로드만).

## 기능 ②: 이력 / 되돌리기

### 이력 목록

- 새 API `GET /api/spaces/[spaceKey]/pages/[slug]/revisions` → `{ version, title, author, source, viaLabel, createdAt }[]` 최신순.
- **본문(content)은 포함하지 않는다**(토큰 절약). `author`는 이름만 노출하고 이메일은 제외한다(기존 PII 규칙).
- MCP 도구 `get_page_history(space, slug)`.

### 특정 버전 원문

- `get_page`에 `version?` 옵션 추가. `GET /api/spaces/[spaceKey]/pages/[slug]?version=N` → 해당 리비전의 `{ title, content, version, source, viaLabel, createdAt }`. 별도 get_revision 도구를 만들지 않고 get_page를 재사용한다.
- MCP `get_page(space, slug, version?)`.

### 되돌리기 (전진형 revert)

- 새 API `POST /api/spaces/[spaceKey]/pages/[slug]/revert` body `{ version, expectedVersion? }` (editor 권한).
- **전진형 revert**: 리비전 vN의 title+content를 읽어 `updatePageInSpace`(전체 교체 경로)에 넘긴다. 즉 **새 리비전(version = page.version+1)으로 기록**되고 이력은 절대 삭제하지 않는다. title도 vN 기준으로 복원한다. 출처(source/viaLabel)는 요청 주체 기준으로 기록(토큰이면 api + 토큰 이름, 세션이면 web). `expectedVersion`이 주어지면 그대로 전달해 충돌을 검사한다.
- MCP 도구 `revert_page(space, slug, version, expectedVersion?)`.
- **웹 히스토리 화면**(`src/app/s/[spaceKey]/[slug]/history/page.tsx`)에 각 리비전마다 "이 버전으로 되돌리기" 버튼(ConfirmSubmitButton) 추가 → 같은 revert 경로 호출.

## 기능 ③: 부분 편집 (API/MCP 전용)

웹 에디터는 WYSIWYG라 부분 편집 도구가 불필요하므로, 부분 편집은 API+MCP에만 노출한다.

### lib 공용 헬퍼

`editPageContent(input, transform)` — 트랜잭션 안에서 현재 본문을 읽어 `transform(content)`를 적용한 뒤 기존 쓰기 경로(리비전 생성 + 링크 동기화 + 출처 기록 + version 증가 + expectedVersion 검사)를 그대로 태운다. title은 유지한다.

```ts
type ContentTransform = (current: string) => string; // 위반 시 throw 가능

async function editPageContent(
  input: { spaceId: string; slug: string; authorId: string; source: EditSource; viaLabel: string | null; expectedVersion?: number },
  transform: ContentTransform,
): Promise<{ version: number }>;
```

### append_to_page

- `append_to_page(space, slug, content, expectedVersion?)`.
- transform: `current`가 비어 있지 않으면 개행 2개로 구분해 뒤에 붙이고, 끝 개행을 정규화한다.
- API `POST /api/spaces/[spaceKey]/pages/[slug]/append` body `{ content, expectedVersion? }`.

### replace_in_page

- `replace_in_page(space, slug, old_string, new_string, expectedVersion?)`.
- transform: `old_string` 등장 횟수를 센다. 0곳 → "old_string을 찾지 못했습니다" 에러, 2곳 이상 → "old_string이 N곳에서 매치됩니다. 더 긴 고유 문맥을 포함하세요" 에러, 정확히 1곳 → 치환. (내부 Edit 도구와 동일 의미)
- API `POST /api/spaces/[spaceKey]/pages/[slug]/replace` body `{ old_string, new_string, expectedVersion? }`.

## 에러 처리 (일관 규약)

| 상황 | HTTP | MCP 반환 |
|---|---|---|
| 버전 충돌 / 경합 | 409 `{ error, currentVersion }` | isError + "현재 vN, get_page로 다시 읽고 재시도" |
| replace 모호 (0곳 / 2곳↑) | 422 `{ error }` | isError + 문맥 보강 안내 |
| 페이지 없음 / 권한 없음 | 404 (기존 숨김 규칙) | isError |
| JSON 파싱 실패 | 400 | isError |

## 컴포넌트 경계 요약

| 유닛 | 책임 | 의존 |
|---|---|---|
| `Page.version` + 마이그레이션 | 동시성 토큰 저장·백필 | Prisma |
| `PageConflictError` | 충돌 신호 타입 | 없음 |
| `updatePageInSpace`(개정) | 버전 검사 있는 전체 교체 | Page.version, PageConflictError |
| `editPageContent` | 트랜잭션 내 read-transform-write | updatePageInSpace 경로 재사용 |
| `revertPage` | vN 내용을 새 리비전으로 전진 복원 | updatePageInSpace(전체 교체) 경로 |
| API 라우트 5종 | HTTP 노출·상태코드 매핑 | 위 lib |
| MCP 도구 6종 | LLM 인터페이스·instructions | API |
| 웹 에디터 충돌 UX / 히스토리 revert 버튼 | 사람↔LLM 양방향 보호 | actions/pages.ts, revert API |

## 테스트

### 단위 (vitest)

- `editPageContent` append: 개행 정규화(빈 문서 / 기존 본문 있는 경우).
- `replace_in_page` transform: 0곳 throw / 2곳 throw / 1곳 치환.
- 낙관적 잠금: `expectedVersion` 불일치 시 `PageConflictError`(currentVersion 포함).
- 경합: 이미 version N+1 리비전이 있는 상태에서 쓰기 → unique 위반이 `PageConflictError`로 번역.
- revert: 새 리비전 생성, `Page.version` 증가, 기존 이력 보존, 복원된 content == vN.
- create/update 후 `Page.version` == 최신 리비전 version 유지.

### e2e (playwright)

- 웹 에디터 충돌: 페이지를 열고, 외부(API)에서 version을 올린 뒤 저장 → 충돌 안내 표시, 최신 불러오기 동작.
- 히스토리 되돌리기: 히스토리 화면에서 되돌리기 버튼 → 본문 복원, 새 리비전이 목록에 추가.

### MCP 라운드트립

- stdio 스크립트로 get_page(version 확인) → update_page(stale expectedVersion → 409) → append_to_page → replace_in_page(0곳·2곳·1곳) → get_page_history → revert_page 흐름 검증.

## 손대는 파일

- `prisma/schema.prisma`: `Page.version Int @default(1)` + 마이그레이션(백필 + searchVector drift 줄 제거).
- `src/lib/pages.ts`: 버전 인지 create/update, `PageConflictError`, `editPageContent`, `revertPage`, `appendToPage`/`replaceInPage` 래퍼.
- `src/app/api/spaces/[spaceKey]/pages/[slug]/route.ts`: GET에 version + `?version=N`, PUT에 expectedVersion → 409.
- 신규 라우트: `.../[slug]/revisions/route.ts`(GET), `.../[slug]/revert/route.ts`(POST), `.../[slug]/append/route.ts`(POST), `.../[slug]/replace/route.ts`(POST).
- `mcp-server/src/tools.ts`: get_page(version?), update_page(expectedVersion?), get_page_history, revert_page, append_to_page, replace_in_page + SERVER_INSTRUCTIONS 갱신 + 버전 bump.
- 웹: `src/actions/pages.ts`(expectedVersion 스레딩 + 충돌 반환), 편집 클라이언트 컴포넌트(충돌 UX), `history/page.tsx`(되돌리기 버튼).
- 테스트: lib 단위 테스트, e2e 추가.

## 범위 밖 (이번 이터레이션 제외)

- 시맨틱/임베딩 검색, 백링크 그래프 노출, 댓글 읽기 도구, 첨부 도구, MCP Resources/Prompts — 가치는 있으나 별도 이터레이션.
- 웹 에디터의 3-way 자동 병합(충돌 시 차단·안내만).
- 부분 편집 도구의 웹 UI 노출(WYSIWYG로 충분).
