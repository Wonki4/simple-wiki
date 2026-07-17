# 에디터 파일 첨부 버튼 설계

**작성일:** 2026-07-16
**목표:** 편집 화면에서 이미지가 아닌 일반 파일(PDF, 문서 등)을 올리고 본문에 다운로드 링크를 삽입할 수 있게 한다. 서버는 변경하지 않는다 — 순수 에디터 확장.

## 배경 / 문제

첨부 백엔드(`POST /api/spaces/{key}/attachments`, 20MB, 전 타입 허용)와 안전한 다운로드(`/api/attachments/{id}` — 권한 검사, 래스터만 인라인, 그 외 `Content-Disposition: attachment`)는 완성돼 있으나, **UI 진입점이 에디터의 이미지 블록(이미지 전용)뿐**이다. 일반 파일을 올릴 방법이 없다. 업로드 API는 브라우저 세션 인증만 받으므로(PAT 불가) UI가 유일한 경로다.

## 결정 사항 (사용자 승인)

- **버튼만** — 에디터 아래 "파일 첨부" 버튼. 드래그앤드롭은 범위 외(Crepe 이미지 드롭 처리와의 간섭 회피, 필요 시 후속).
- 서버·API·권한 변경 없음.

## UI (`src/components/MarkdownEditor.tsx`)

- 에디터 아래 안내문(`meta`) 영역에 **"파일 첨부"** 버튼(`type="button"`, `btn btn-sm`) + 숨긴 `<input type="file" multiple>` (ref로 연결, 버튼 클릭 → `input.click()`).
- 파일 선택 시 **순차 업로드** — 기존 이미지 블록 `onUpload`와 동일한 엔드포인트/FormData. 업로드 중 버튼 라벨 "올리는 중..." + disabled (`uploading` state).
- 실패 시 기존 저장 실패 패턴과 동일하게 `alert("파일 업로드에 실패했습니다: {파일명}")` — 성공한 파일의 링크는 유지, 실패한 파일부터 중단.
- 같은 input으로 같은 파일을 다시 선택할 수 있도록 처리 후 `input.value = ""` 초기화.

## 본문 삽입

업로드 응답 `{ url, filename }`으로 **커서 위치에** 마크다운 삽입:

- `image/*` 파일 → `![파일명](url)` (본문 인라인 표시)
- 그 외 → `[파일명](url)` (읽기 화면에서 클릭 시 다운로드)

삽입 방법: Crepe가 노출하는 Milkdown 인스턴스 사용 — `crepeRef.current.editor.action(insert(마크다운))` (`insert`는 `@milkdown/kit/utils`, 블록 삽입 기본 동작 = 커서 위치에 새 문단). 여러 파일이면 파일마다 한 번씩 삽입.

**의존성:** `@milkdown/kit`을 package.json에 명시적으로 추가한다. Crepe(7.21)의 기반 패키지라 이미 설치돼 있지만, 직접 import하는 이상 미선언 전이 의존성으로 두면 잠재 사고다. 버전은 설치된 것과 동일 계열(^7.x).

주의: 삽입 후 Crepe의 `markdownUpdated` 리스너가 발화해 `content` state가 갱신되는 것이 정상 경로다 — 별도 state 동기화 코드를 추가하지 않는다.

## 안내문 갱신

기존: "이미지를 붙여넣거나 끌어다 올릴 수 있습니다. [[페이지명]]으로 위키링크를 만들 수 있습니다."
갱신: "이미지는 붙여넣기/드래그로, 일반 파일은 '파일 첨부' 버튼으로 올릴 수 있습니다. [[페이지명]]으로 위키링크를 만들 수 있습니다."

## 테스트

- **e2e 1건 추가** (`e2e/wiki.spec.ts`): alice가 eng 스페이스 페이지 편집 → "파일 첨부" 버튼의 file input에 `setInputFiles`로 텍스트 파일 지정 → 본문에 `[파일명]` 링크 삽입 확인 → 저장 → 읽기 화면에서 링크 존재 확인 → 링크 href를 `page.request.get`으로 요청해 `Content-Disposition`에 `attachment` 포함 확인.
- 단위 테스트 없음 (클라이언트 UI — 기존 컨벤션대로 e2e 커버). `npx tsc --noEmit` 게이트는 유지.

## 범위 밖

- 일반 파일 드래그앤드롭/붙여넣기
- 첨부 목록·삭제 UI, 고아 첨부 GC (기존 백로그)
- 업로드 진행률 표시, 파일 타입별 아이콘
