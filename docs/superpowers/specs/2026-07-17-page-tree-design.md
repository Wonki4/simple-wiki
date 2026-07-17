# 페이지 트리 설계 — 스페이스 내 문서 계층

**작성일:** 2026-07-17
**목표:** 스페이스 안의 플랫한 문서 목록을 부모-자식 페이지 트리로 확장한다. "폴더" 엔티티 없이 모든 노드가 문서인 Confluence/Notion 방식. 웹과 MCP 양쪽에서 트리를 만들고·보고·옮길 수 있다.

## 배경 / 문제

- 스페이스 내 문서는 완전 플랫이다: 사이드바(`src/app/s/[spaceKey]/layout.tsx` → `SidebarDocs`)가 전체 문서를 `updatedAt desc`로 나열하고, 8개 초과 시 "빠른 찾기" 필터로 버틴다. 문서가 수십 개를 넘으면 탐색형 접근(상위 주제 아래 뭐가 있나)이 불가능하다.
- 위키링크·검색은 알지만-찾는 접근만 커버한다.

## 결정 사항 (사용자 승인)

- **페이지 트리 방식** (폴더 엔티티 배제) — `Page.parentId` self-relation, 모든 노드가 본문을 가짐.
- **생성 UX**: 문서 화면에 "하위 문서" 버튼(부모 고정), 기존 "새 문서"는 최상위. 생성 폼의 부모 드롭다운은 없음.
- **이동 기능 v1 포함**: 문서 화면에서 부모 선택(최상위 포함), 자기 자신·자손 제외.
- **MCP 반영 포함**: `list_pages` 트리 표기, `create_page`에 `parent`, 신규 `move_page`.

## 데이터 모델

```prisma
model Page {
  // ... 기존 필드 ...
  // 페이지 트리: 같은 스페이스 안의 부모 문서. null이면 최상위.
  // 부모 삭제 시 자식은 앱 로직으로 조부모로 승격되므로 DB는 Restrict가 아닌 NoAction 불필요 — 관계만 선언.
  parentId  String?
  parent    Page?   @relation("PageTree", fields: [parentId], references: [id])
  children  Page[]  @relation("PageTree")

  @@index([parentId])
}
```

- 마이그레이션 additive (`parentId` nullable + index + self-FK). 기존 문서는 전부 최상위.
- **불변식**: 부모는 반드시 같은 스페이스의 문서. 순환 금지(자기 자신/자손을 부모로 불가). 서버(액션·API)에서 강제.
- slug는 스페이스 내 유일 **유지** — URL(`/s/{key}/{slug}`)과 위키링크는 트리와 독립, 이동해도 불변.
- 형제 정렬: **제목순**(v1). 수동 정렬(position)은 후속.
- 깊이 제한 없음 (UI 들여쓰기가 자연 억제).

## 트리 로직 (`src/lib/page-tree.ts`, 신규 — 순수 함수)

- `buildTree(pages: {id, slug, title, parentId}[]): TreeNode[]` — 플랫 목록 → 정렬된(제목순) 트리. 고아(parentId가 목록에 없음 — 이론상 없음)는 최상위로.
- `descendantIds(pages, rootId): Set<string>` — 순환 검증·이동 대상 제외 목록용.
- 순수 함수라 vitest 단위 테스트 대상 (기존 컨벤션).

## 생성 — "하위 문서"

- 문서 화면(`src/app/s/[spaceKey]/[slug]/page.tsx`)에 "하위 문서" 버튼 → `/s/{key}/new?parent={slug}`.
- new 페이지가 `searchParams.parent`를 읽어 hidden field로 전달, 헤더에 "'{부모 제목}' 하위에 만듭니다" 안내.
- `createPage` 액션: `parent` slug가 오면 같은 스페이스에서 조회해 `parentId` 설정. 없는 slug면 `?error=` 배너(무시하고 최상위 생성하지 않음 — 명시적 실패).

## 이동

- 문서 화면에 "이동" — 부모 선택 `<select>`(옵션: "(최상위)" + 자기 자신·자손을 제외한 전체 문서, 제목순·들여쓰기 표기) + 확인 버튼. 별도 페이지가 아닌 문서 화면 내 폼(관리 요소들 옆).
- 신규 액션 `movePage(spaceKey, slug, formData)`: editor 권한, 서버에서 같은 스페이스·순환 재검증. 실패는 `?error=` 배너(PR #8 패턴 — 문서 화면에 searchParams 배너 추가), 성공은 쿼리 없는 경로로 redirect.
- 이동은 리비전을 만들지 않는다(본문 불변 — 버전·이력 무관).

## 삭제 시 자식 처리

- `deletePage` 경로에서 트랜잭션으로: 자식들의 `parentId`를 삭제 문서의 `parentId`로 승격(재부모화) → 문서 삭제. 내용이 함께 사라지는 일이 없다.

## 사이드바 트리 (`SidebarDocs`)

- 플랫 `<NavLink>` 목록 → 트리 렌더: 들여쓰기 + 자식 있는 노드에 접기/펼치기 토글(클라이언트 state, 기본 전부 펼침).
- 기존 "빠른 찾기" 필터 유지 — **필터 입력 중에는 플랫 매칭 목록으로 전환**(트리 필터의 복잡성 회피), 비우면 트리로 복귀.
- layout의 조회를 `orderBy: { title: "asc" }` + `parentId` select 추가로 변경.

## API / MCP

- **API**: `GET /api/spaces/{key}/pages`(기존 목록)가 `parentSlug` 필드 포함. `POST .../pages`(생성)에 `parent`(slug) 옵션. 신규 `POST .../pages/{slug}/move` body `{ parent: string | null }` — editor 권한, 404 은닉·순환 시 422.
- **MCP** (`mcp-server/src/tools.ts`): `list_pages` 출력을 트리 들여쓰기 텍스트로(+ parent 정보), `create_page`에 `parent` 옵션, 신규 `move_page(space, slug, parent)` (`parent: null`이면 최상위). SERVER_INSTRUCTIONS에 트리 규칙 추가, 버전 bump.

## 영향 없음 (확인)

권한(스페이스 단위), 위키링크(제목 기반), 검색, 첨부, 낙관적 잠금·리비전 — 전부 트리와 독립. `Page.version`/이력 로직 무변경.

## 테스트

- **단위**: `page-tree.ts` — buildTree(정렬·중첩·고아), descendantIds(순환 방지 근거).
- **e2e**: 하위 문서 생성 → 사이드바 트리(들여쓰기) 표시 → 이동(다른 부모로) → 삭제 시 자식 승격 확인. 기존 테스트 무영향(전부 최상위 생성 경로 유지).
- **MCP 스모크**: create_page(parent) → list_pages 트리 확인 → move_page 라운드트립.

## 전제 / 순서

- **PR #8(에러 배너 패턴·e2e 수정)과 PR #9(e2e 수정) 머지 후 최신 main에서 구현 시작** — 이 스펙 문서는 선행 커밋하고 rebase.

## 범위 밖

- 수동 정렬(드래그), 트리 상태(접힘) 저장, 페이지별 권한, 이동 시 스페이스 간 이동, breadcrumb 표시(후속 후보), 폴더 전용 엔티티.
