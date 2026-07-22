# MCP 첨부파일 업로드 설계

날짜: 2026-07-21 · 상태: 승인됨(대화로 합의)

## 목표

개인 액세스 토큰(PAT)으로 첨부파일을 업로드/다운로드할 수 있게 하여, MCP 클라이언트(Claude Desktop 등)가
위키에 파일을 올리고 문서 본문에 링크를 삽입할 수 있게 한다.

## 현재 상태 (문제)

- 첨부 REST 라우트 2개가 **브라우저 세션 쿠키 전용**(`getSessionInfo`)이다. 토큰으로 호출하면 401.
  - `POST /api/spaces/{spaceKey}/attachments` (업로드, editor)
  - `GET /api/attachments/{id}` (다운로드, viewer)
- mcp-server(v1.3.0)에 첨부 관련 도구가 없다.

## 설계

### 1) 첨부 REST 라우트를 토큰+세션 겸용으로

페이지 API들이 이미 쓰는 `requireApiSpaceRole`/`resolveApiActor`(lib/api-auth)는
Authorization 헤더가 있으면 토큰, 없으면 세션으로 폴백한다. 첨부 라우트도 같은 헬퍼로 전환한다.

- 업로드: `getSessionInfo` + 수동 스페이스/권한 판정 → `requireApiSpaceRole(req, spaceKey, "editor")` 한 방으로 교체.
  토큰 rate limit도 자동 적용된다. 응답 JSON(`{id, url, filename}`)과 20MB 제한은 불변.
- 다운로드: `getSessionInfo` → `resolveApiActor(req)` + `rateLimitResponse`. viewer 판정과 404 은닉,
  inline 허용목록(MIME) 로직은 불변.
- 미세 변화: 401 본문이 "로그인이 필요합니다" → "인증이 필요합니다"로 통일된다(허용).

### 2) mcp-server `upload_attachment` 도구 (v1.3.0 → 1.4.0)

- 입력: `space`(스페이스 키), `path`(**MCP 서버가 실행 중인 머신의** 파일 경로), `filename`(선택, 기본 basename).
  - base64 전달 방식은 채택하지 않음: 20MB 파일이 모델 컨텍스트를 태운다. stdio 모드(로컬 실행)가 주 사용처.
  - 원격 HTTP 모드에서는 "서버 머신의 경로"라는 한계를 도구 설명에 명시한다.
- 동작: `fs.stat`으로 20MB 사전 검사 → 파일 읽기 → 확장자→MIME 매핑(주요 15종, 그 외 octet-stream)
  → `FormData`+`Blob` multipart로 업로드 API 호출 → 성공 시 `{id, url, filename}`과 함께
  "본문 삽입은 `![파일명](url)`(이미지) 또는 `[파일명](url)`" 가이드 텍스트 반환.
- `api()` 헬퍼 수정: body가 **문자열일 때만** `Content-Type: application/json`을 붙인다
  (FormData는 fetch가 boundary 포함 multipart 헤더를 자동 설정해야 함).
- `SERVER_INSTRUCTIONS`에 첨부 섹션 추가(업로드 → append_to_page/replace_in_page로 본문 삽입 흐름).

## 테스트

- e2e: alice 로그인 → /settings/tokens에서 토큰 발급(`data-testid="new-token"`) →
  쿠키 없는 `request` 픽스처로 ① Bearer 업로드 200 ② Bearer 다운로드 200+바이트 일치 ③ 무인증 업로드 401.
- mcp-server: 빌드 + MCP SDK 클라이언트(stdio)로 실제 upload_attachment 호출 스모크(라이브 dev 서버 대상).

## 비범위 (YAGNI)

- 첨부 목록/삭제 MCP 도구, pageId 연결, base64 업로드, 다운로드 MCP 도구(URL은 브라우저/curl로 접근 가능).

## 2026-07-22 개정: content_base64 · url 입력 추가 (v1.5.0)

운영 배포 형태가 **원격 HTTP 모드**(compose mcp 서비스 — 조직 LLM이 각자 PAT로 접속)라서,
클라이언트 머신의 파일 경로는 서버에서 원천적으로 접근 불가 → path 단독 설계로는 실사용 불가 판정.
`upload_attachment` 입력을 셋 중 정확히 하나로 확장:

- `path` — 로컬 stdio 실행일 때만 유효 (기존 동작 유지)
- `content_base64` — 파일 내용 자체. 모델 컨텍스트를 통과하므로 디코드 후 4MB 상한(사전 문자열 길이 검사로 거대 입력 디코드 회피). filename 필수.
- `url` — 서버가 fetch해 업로드. http(s) 한정, 15초 타임아웃, content-length 사전검사 + 스트림 읽기 상한(20MB) 이중 방어. MIME은 응답 Content-Type 우선, 없으면 확장자 매핑. filename 생략 시 URL 경로에서 유도.
  주의: 서버 네트워크 위치에서의 fetch이므로 사내망 SSRF 가능성 있음 — 사내 전용 도구 전제로 스킴·크기·시간 제한만 적용(필요 시 도메인 허용목록 후속).

검증(2026-07-22): stdio 클라이언트 스모크로 3개 모드 업로드 + 바이트 일치(랜덤 2KB 바이너리 포함) + 에러 경로 5종(무입력/복수입력/filename 누락/비http 스킴/404) 전부 확인.
