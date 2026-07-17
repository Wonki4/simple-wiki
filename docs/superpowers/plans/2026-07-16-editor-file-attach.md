# 에디터 파일 첨부 버튼 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 편집 화면에 "파일 첨부" 버튼을 추가해 일반 파일을 올리고 본문 커서 위치에 다운로드 링크(이미지는 인라인 이미지)를 삽입한다. 서버 무변경.

**Architecture:** `MarkdownEditor.tsx`에 숨긴 file input + 버튼 + 순차 업로드 핸들러를 추가하고, Crepe가 노출하는 Milkdown 인스턴스로 `editor.action(insert(마크다운))` 커서 삽입. `@milkdown/kit`(crepe의 기반 패키지, 이미 설치됨)을 명시적 의존성으로 선언.

**Tech Stack:** Next.js 15 클라이언트 컴포넌트, Milkdown Crepe 7.21.2 + `@milkdown/kit` 7.21.2, Playwright.

**Spec:** `docs/superpowers/specs/2026-07-16-editor-file-attach-design.md`

## Global Constraints

- 브랜치 `feat/editor-file-attach` (체크아웃됨, base ce77741 + 스펙 커밋 9b5b381). **주의:** PR #8(fix/permission-add-ux)이 `e2e/wiki.spec.ts`를 수정했고 아직 머지 전 — PR 생성 전 main이 전진했으면 rebase.
- 타입체크 `npx tsc --noEmit`. **`npm run build` 절대 금지** (dev 서버 :3000 떠 있음 — .next 파손).
- e2e 전체 실행은 DB 리셋 필요 — **컨트롤러가 사용자 동의 받아 수행**, 서브에이전트는 reset 시도 금지. 마이그레이션 후엔 dev 서버 재기동 필요(이 플랜은 마이그레이션 없음 — 해당 없음).
- 업로드 API·권한·서버 코드 무변경. 파일 제한(20MB, SVG 인라인 차단)은 서버가 이미 강제.
- UI 문구 한국어, 기존 클래스(`btn btn-sm`, `meta`) 재사용. 커밋: prefix+한국어+`Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.

---

### Task 1: 에디터 파일 첨부 버튼

**Files:**
- Modify: `package.json` (`@milkdown/kit` 의존성)
- Modify: `src/components/MarkdownEditor.tsx`

**Interfaces:**
- Consumes: 기존 업로드 API(`POST /api/spaces/{key}/attachments` → `{ url, filename }`), `crepeRef`(기존), `insert`(`@milkdown/kit/utils`).
- Produces: e2e 계약 — 파일 input은 **form의 직계 자식** `form > input[type="file"]`(Crepe 내부 이미지 input과 구분), 버튼 텍스트 "파일 첨부"/"올리는 중...".

- [ ] **Step 1: 의존성 선언**

```bash
npm install @milkdown/kit@7.21.2
```

Expected: package.json에 `"@milkdown/kit": "7.21.2"` 추가 (crepe가 같은 버전을 핀하고 있어 이미 설치돼 있음 — lockfile 변화 최소).

- [ ] **Step 2: MarkdownEditor.tsx 수정**

import 추가 (파일 상단):

```tsx
import { insert } from "@milkdown/kit/utils";
```

컴포넌트 안 state/ref 선언부(`const crepeRef = ...` 다음)에 추가:

```tsx
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
```

`useEffect` 아래(return 위)에 핸들러 추가:

```tsx
  // 파일 첨부 버튼: 순차 업로드 후 커서 위치에 링크 삽입(이미지는 인라인 이미지).
  // 실패하면 성공분 링크는 유지하고 그 파일부터 중단한다.
  async function attachFiles(files: FileList | null) {
    if (!files || files.length === 0 || !crepeRef.current) return;
    setUploading(true);
    try {
      for (const file of Array.from(files)) {
        const fd = new FormData();
        fd.append("file", file);
        const res = await fetch(`/api/spaces/${spaceKey}/attachments`, { method: "POST", body: fd });
        if (!res.ok) {
          alert(`파일 업로드에 실패했습니다: ${file.name}`);
          break;
        }
        const { url, filename } = (await res.json()) as { url: string; filename: string };
        // 링크 텍스트의 대괄호는 마크다운 링크 문법을 깨므로 제거한다.
        const label = filename.replace(/[[\]]/g, "");
        const md = file.type.startsWith("image/") ? `![${label}](${url})` : `[${label}](${url})`;
        crepeRef.current.editor.action(insert(md));
      }
    } finally {
      setUploading(false);
      // 같은 파일을 연속으로 다시 선택할 수 있도록 초기화.
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }
```

기존 안내문 블록:

```tsx
      <p className="meta mt-2.5">
        이미지를 붙여넣거나 끌어다 올릴 수 있습니다. [[페이지명]]으로 위키링크를 만들 수 있습니다.
      </p>
```

을 다음으로 교체:

```tsx
      <div className="mt-2.5 flex items-center gap-3">
        <button
          type="button"
          className="btn btn-sm"
          disabled={uploading}
          onClick={() => fileInputRef.current?.click()}
        >
          {uploading ? "올리는 중..." : "파일 첨부"}
        </button>
        <p className="meta">
          이미지는 붙여넣기/드래그로, 일반 파일은 &apos;파일 첨부&apos; 버튼으로 올릴 수 있습니다. [[페이지명]]으로
          위키링크를 만들 수 있습니다.
        </p>
      </div>
      <input ref={fileInputRef} type="file" multiple hidden onChange={(e) => attachFiles(e.target.files)} />
```

(hidden input은 form의 직계 자식 위치 — e2e 셀렉터 계약. `name` 속성을 주지 않아 form 제출 데이터에 섞이지 않는다.)

- [ ] **Step 3: 타입체크**

```bash
npx tsc --noEmit
```

Expected: 에러 0. (`crepeRef.current.editor`가 타입에 없다고 나오면 BLOCKED로 보고 — Crepe 7.21은 `get editor(): Editor`를 노출하므로 정상적으로는 통과.)

- [ ] **Step 4: 수동 스모크 (dev 서버 :3000 재사용)**

브라우저로 확인이 어려우면 생략하고 Task 2의 e2e에 맡긴다 — 단, 생략 시 리포트에 명시.

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json src/components/MarkdownEditor.tsx
git commit -m "feat(editor): 파일 첨부 버튼 — 업로드 후 커서 위치에 링크/이미지 삽입

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: e2e + 전체 검증 + PR

**Files:**
- Modify: `e2e/wiki.spec.ts` (신규 테스트 1건 — 파일 끝에 추가)

**Interfaces:**
- Consumes: Task 1의 UI 계약(`form > input[type="file"]`, 버튼 "파일 첨부"), 기존 다운로드 라우트의 `Content-Disposition: attachment`.

- [ ] **Step 1: e2e 테스트 추가 (파일 맨 끝)**

```ts
test("파일 첨부: 버튼으로 올리고 본문 다운로드 링크로 확인", async ({ page }) => {
  await login(page, "alice", "alice1234");
  await page.goto("/s/eng/new");
  await page.locator('input[name="title"]').fill("파일 첨부 테스트");

  // 숨긴 파일 input은 form 직계 자식 — Crepe 내부의 이미지 input과 구분된다.
  await page.locator('form > input[type="file"]').setInputFiles({
    name: "spec.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("hello attachment"),
  });
  // 업로드 완료 → 에디터 본문에 링크 텍스트 삽입 확인
  await expect(page.locator(".wysiwyg").getByText("spec.txt")).toBeVisible();

  await page.getByRole("button", { name: "저장" }).click();
  await expect(page.getByRole("heading", { name: "파일 첨부 테스트" })).toBeVisible();

  // 읽기 화면의 링크가 attachment로 내려오는지 (인라인 아님 = 다운로드)
  const href = await page.getByRole("link", { name: "spec.txt" }).getAttribute("href");
  expect(href).toMatch(/^\/api\/attachments\//);
  const res = await page.request.get(href!);
  expect(res.status()).toBe(200);
  expect(res.headers()["content-disposition"] ?? "").toContain("attachment");
});
```

- [ ] **Step 2: 단위 + 타입**

```bash
npm test && npx tsc --noEmit
```

Expected: 52/52, 에러 0.

- [ ] **Step 3: e2e 준비 — DB 리셋 (컨트롤러 담당, 서브에이전트 시도 금지)**

- [ ] **Step 4: e2e 전체**

```bash
npm run e2e
```

Expected: 12/12 PASS (기존 11 + 신규 1).

- [ ] **Step 5: 커밋 + rebase 확인 + PR**

```bash
git add e2e/wiki.spec.ts
git commit -m "test(e2e): 에디터 파일 첨부 시나리오

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
git fetch origin main
# origin/main이 전진했고 e2e/wiki.spec.ts가 겹치면: git rebase origin/main (충돌 시 both-keep 해소) 후 전체 검증 재실행
git push -u origin feat/editor-file-attach
gh pr create --title "feat: 에디터 파일 첨부 버튼" --body "$(cat <<'EOF'
## Summary
- 편집 화면에 "파일 첨부" 버튼 — 일반 파일(PDF 등)을 올리고 본문 커서 위치에 다운로드 링크 삽입 (이미지 파일이면 인라인 이미지)
- 여러 파일 순차 업로드, 실패 시 성공분 유지 + alert, 같은 파일 재선택 가능
- 서버 무변경 — 기존 첨부 API/권한/20MB 제한/SVG 차단 그대로. `@milkdown/kit` 명시적 의존성 선언(커서 삽입 API)

설계: docs/superpowers/specs/2026-07-16-editor-file-attach-design.md

## Test plan
- [ ] unit 52/52 / tsc 0
- [ ] e2e 12/12 — 파일 첨부→링크 삽입→저장→attachment 다운로드 확인 시나리오 포함

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Self-Review 결과

- 스펙 커버리지: 버튼+숨긴 input+순차 업로드+커서 삽입+이미지 분기+초기화+안내문(Task 1), e2e/검증/PR(Task 2). 드래그앤드롭·첨부관리 UI는 범위 밖 유지.
- 타입 일관성: `insert`(kit/utils)·`crepeRef.current.editor` — Crepe 7.21 공개 API. e2e 셀렉터 계약(`form > input[type="file"]`, "파일 첨부")이 Task 1 마크업과 일치.
- 엣지: 파일명 대괄호 제거(링크 문법 보호), input에 name 미부여(폼 데이터 오염 방지), uploading 중 버튼 비활성.
