# simple-wiki 설계 문서

- 날짜: 2026-07-09
- 상태: 승인됨 (브레인스토밍 세션에서 사용자 승인)

## 개요

수십~수백 명 규모 조직에서 사용하는 마크다운 기반 위키.
Keycloak으로 인증하고, 스페이스(부서/프로젝트) 단위로 권한을 관리한다.
"simple"이 목표: 페이지 단위 ACL, 실시간 협업 편집 같은 복잡한 기능은 의도적으로 제외한다.

## 확정된 요구사항

- 사용 대상: 회사/조직 (수십~수백 명)
- 기술 스택: Next.js 풀스택 (App Router, TypeScript)
- 저장소: PostgreSQL (문서 본문·버전·권한 모두 DB에 저장)
- 인증: Keycloak (docker-compose로 새로 구성, realm 설정을 코드로 관리)
- 권한: 스페이스 단위 (viewer / editor / admin)
- v1 기능: 페이지 CRUD, 마크다운 렌더링, 전문 검색, 버전 이력, 이미지/파일 첨부, 위키 링크(`[[페이지명]]`)

## 아키텍처

Next.js 단일 풀스택 앱 + PostgreSQL + Keycloak.

```
[브라우저] ──▶ [Next.js 앱]
                 ├─ 페이지 UI (React Server Components + CodeMirror 에디터)
                 ├─ 서버 액션 / API Route (모든 요청은 서버 측 권한 검사 통과)
                 ├─ Auth.js(next-auth v5) ── OIDC ──▶ [Keycloak]
                 └─ Prisma ORM ──▶ [PostgreSQL]
```

- **로컬 개발**: `docker-compose`로 PostgreSQL + Keycloak 기동.
  Keycloak realm 설정(클라이언트, realm 역할, 테스트 유저/그룹)은 realm export JSON으로
  리포지토리에 커밋하고 컨테이너 시작 시 자동 임포트한다.
  → `docker compose up` 한 번으로 누구나 동일한 개발 환경을 얻는다.
- **인증 플로우**: Auth.js Keycloak OIDC provider 사용.
  로그인 시 ID 토큰의 `groups` 클레임과 realm 역할을 세션에 저장하고,
  사용자 정보(sub/email/name)는 첫 로그인 시 DB `User` 테이블에 동기화(upsert)한다.
- **배포**: 앱용 Dockerfile 제공. 운영 환경에서는 기존 Keycloak/PostgreSQL로 교체 가능
  (환경변수로 접속 정보 주입).

## 권한 모델

- **전역 관리자**: Keycloak realm 역할 `wiki-admin`.
  스페이스 생성/삭제, 모든 스페이스 관리 가능.
- **스페이스 역할** (3단계, 상위 역할은 하위 권한 포함):
  - `viewer`: 페이지 읽기, 검색, 첨부 다운로드
  - `editor`: viewer + 페이지 생성/수정/삭제, 첨부 업로드
  - `admin`: editor + 스페이스 설정 변경, 권한 관리
- **부여 대상**: Keycloak 그룹(그룹 경로 문자열로 참조, 예: `/engineering`) 또는 개별 사용자.
- **스페이스 공개 범위**:
  - `organization`: 로그인한 모든 사용자가 읽기 가능 (쓰기는 별도 권한 필요)
  - `restricted`: 권한이 부여된 사용자/그룹만 접근 가능
- **검사 지점**: 모든 데이터 접근은 서버 측에서 인가된다. 페이지·서버 액션은
  `requireSpaceRole(spaceKey, role)`(미로그인/무권한 시 redirect·notFound)로,
  API route는 `getSessionInfo` + `resolveSpaceRole`/`hasRole`로 검사하고 401/403/404
  JSON을 반환한다. 클라이언트 측 상태는 신뢰하지 않는다. 검색 결과도 읽기 권한이 있는
  스페이스로 필터링한다.

## 데이터 모델 (Prisma)

| 테이블 | 핵심 필드 | 비고 |
|---|---|---|
| `User` | id, keycloakSub(unique), email, name | 첫 로그인 시 upsert |
| `Space` | id, key(unique, URL용), name, description, visibility | visibility: organization \| restricted |
| `SpacePermission` | spaceId, subjectType(user\|group), subjectRef, role | subjectRef: User.id 또는 Keycloak 그룹 경로 |
| `Page` | id, spaceId, slug, title, content, searchVector, createdById, updatedAt | (spaceId, slug) unique. searchVector는 tsvector + GIN 인덱스 |
| `PageRevision` | pageId, version, title, content, authorId, createdAt | 저장 때마다 스냅샷. 이력 조회/복원용 |
| `PageLink` | fromPageId, toSlug, toSpaceId | 저장 시 `[[링크]]` 파싱해 기록. 백링크와 red link 판별용 |
| `Attachment` | id, pageId, filename, mime, size, storageKey, uploaderId | |

- 현재 본문은 `Page.content`에 비정규화(최신 리비전과 동일 내용).
- `searchVector`는 제목+본문 기반으로 저장 시 갱신. 한국어는 형태소 분석 없이도 동작하도록
  tsvector는 `simple` config를 쓰고, 부분 일치 검색을 위해 pg_trgm 트라이그램 인덱스를 병행한다.

## 주요 기능 동작

### 에디터 & 렌더링
- CodeMirror 6 마크다운 에디터 + 실시간 미리보기(분할 화면).
- 이미지 붙여넣기/드래그 시 자동 업로드 후 마크다운 링크 삽입.
- 렌더링: remark/rehype 파이프라인 (GFM 지원) + `rehype-sanitize`(XSS 차단) + shiki 코드 하이라이트.
- `[[페이지명]]`: 커스텀 remark 플러그인으로 같은 스페이스 내 링크로 변환.
  대상 페이지가 없으면 red link로 표시하고, 클릭 시 해당 제목으로 새 페이지 생성 화면으로 이동.

### 검색
- PostgreSQL FTS(제목 + 본문). 검색 결과는 읽기 권한이 있는 스페이스로 필터링.

### 버전 이력
- 페이지별 이력 목록 → 특정 버전 보기 → 복원(이전 내용을 새 리비전으로 저장).
- 동시 편집 충돌은 "마지막 저장 승리(last-write-wins)" — 이력에서 언제든 복구 가능.

### 첨부파일
- 로컬 디스크(도커 볼륨) 저장. 스토리지 인터페이스로 추상화해 추후 S3 호환 스토리지로 교체 가능.
- 다운로드는 권한 검사를 거치는 API route 경유 (직접 정적 서빙 금지).

## 에러 처리

- 미로그인: 로그인 페이지로 리다이렉트 (Keycloak).
- 권한 없음: 403 페이지 (스페이스 존재 여부는 노출하지 않음 — restricted 스페이스는 404로 처리).
- 없는 페이지: 404 + "이 제목으로 페이지 만들기" 제안 (editor 권한 시).
- 저장 실패/업로드 실패: 에디터 내용 유실 없이 사용자에게 오류 표시.

## 테스트

- **Vitest**: 권한 판정 로직(`requireSpaceRole` 등), 위키링크 파서, slug 생성 등 순수 로직 단위 테스트.
- **Playwright e2e**: docker-compose 환경에서 Keycloak 테스트 유저로 로그인 →
  페이지 생성/편집 → 검색 → 권한 없는 스페이스 접근 차단 확인.

## v1에서 명시적으로 제외 (YAGNI)

- 실시간 협업 편집 (충돌은 last-write-wins + 버전 이력으로 복구)
- 댓글, 알림
- 페이지 단위 ACL
- 다국어 UI
- WYSIWYG 에디터 (마크다운 소스 편집 + 미리보기만)
