# MCP 첨부파일 업로드 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 개인 액세스 토큰(PAT)으로 첨부 업로드/다운로드가 가능하게 하고, mcp-server에 `upload_attachment` 도구를 추가한다.

**Architecture:** 첨부 REST 라우트 2개를 페이지 API와 같은 `requireApiSpaceRole`/`resolveApiActor`(토큰→세션 폴백)로 전환. mcp-server는 로컬 파일 경로를 받아 multipart로 업로드 API를 호출하는 도구를 추가하고 v1.4.0으로 올린다.

**Tech Stack:** Next.js 15 route handlers, Prisma 6, Playwright e2e, @modelcontextprotocol/sdk, Node 20 글로벌 fetch/FormData/Blob.

## Global Constraints

- **`npm run build` 절대 금지** (라이브 dev 서버의 .next 파손). 타입 검증은 `npx tsc --noEmit`만. **mcp-server 디렉토리의 빌드는 허용**(`cd mcp-server && npm run build`).
- 업로드 최대 크기 20MB (`MAX_SIZE = 20 * 1024 * 1024`) — 기존 값 유지.
- 업로드 성공 응답 JSON 형태 불변: `{ id, url: "/api/attachments/<id>", filename }`.
- 다운로드의 404 은닉(무권한=404), inline 허용목록(`image/png|jpeg|gif|webp`만 inline) 로직 불변.
- mcp-server 버전은 `1.4.0`으로 — `mcp-server/src/tools.ts`의 `McpServer` 생성자와 `mcp-server/package.json` 두 곳 모두.
- e2e는 라이브 dev 서버(:3000, alice/alice1234)를 대상으로 한다. dev DB를 리셋하지 않는다.
- 커밋 메시지 말미: `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`

---

### Task 1: 첨부 REST 라우트 토큰 인증 전환 + e2e

**Files:**
- Modify: `src/app/api/spaces/[spaceKey]/attachments/route.ts` (전체 교체 수준)
- Modify: `src/app/api/attachments/[id]/route.ts` (인증부만)
- Test: `e2e/wiki.spec.ts` (테스트 1개 추가, 파일 끝)

**Interfaces:**
- Consumes: `requireApiSpaceRole(req, spaceKey, role)`, `resolveApiActor(req)`, `rateLimitResponse(actor)` — `src/lib/api-auth.ts`에 이미 존재.
- Produces: 토큰으로 호출 가능한 `POST /api/spaces/{key}/attachments`, `GET /api/attachments/{id}` (Task 2가 사용).

- [ ] **Step 1: 업로드 라우트 교체**

`src/app/api/spaces/[spaceKey]/attachments/route.ts` 전체를 다음으로 교체:

```ts
import { NextRequest } from "next/server";
import { requireApiSpaceRole } from "@/lib/api-auth";
import { prisma } from "@/lib/db";
import { storage } from "@/lib/storage";

const MAX_SIZE = 20 * 1024 * 1024;

// 업로드는 웹 세션과 API 토큰(Bearer) 모두 허용한다. 판정·rate limit은 페이지 API와 동일.
export async function POST(req: NextRequest, ctx: { params: Promise<{ spaceKey: string }> }) {
  const { spaceKey } = await ctx.params;
  const auth = await requireApiSpaceRole(req, spaceKey, "editor");
  if (!auth.ok) return auth.response;

  const contentLength = Number(req.headers.get("content-length") ?? 0);
  if (contentLength > MAX_SIZE + 1024 * 1024) {
    return Response.json({ error: "20MB 이하만 업로드할 수 있습니다." }, { status: 413 });
  }

  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) return Response.json({ error: "file 필드가 필요합니다." }, { status: 400 });
  if (file.size > MAX_SIZE) return Response.json({ error: "20MB 이하만 업로드할 수 있습니다." }, { status: 413 });

  const key = `${auth.space.id}/${crypto.randomUUID()}`;
  await storage.put(key, Buffer.from(await file.arrayBuffer()));
  const att = await prisma.attachment.create({
    data: {
      spaceId: auth.space.id,
      filename: file.name || "attachment",
      mime: file.type || "application/octet-stream",
      size: file.size,
      storageKey: key,
      uploaderId: auth.actor.userId,
    },
  });

  return Response.json({ id: att.id, url: `/api/attachments/${att.id}`, filename: att.filename });
}
```

(기존과의 차이: `getSessionInfo`+수동 스페이스 조회/권한 판정 → `requireApiSpaceRole` 하나로. 404/403/401 응답은 헬퍼가 만든다. 20MB 검사·저장·응답은 그대로.)

- [ ] **Step 2: 다운로드 라우트 인증부 교체**

`src/app/api/attachments/[id]/route.ts`에서 import와 인증부만 수정:

```ts
import { NextRequest } from "next/server";
import { resolveApiActor, rateLimitResponse } from "@/lib/api-auth";
import { prisma } from "@/lib/db";
import { hasRole, resolveSpaceRole } from "@/lib/permissions";
import { storage, StorageNotFoundError } from "@/lib/storage";

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const actor = await resolveApiActor(req);
  if (!actor) return new Response("인증이 필요합니다.", { status: 401 });
  const limited = rateLimitResponse(actor);
  if (limited) return limited;

  const att = await prisma.attachment.findUnique({
    where: { id },
    include: { space: { include: { permissions: true } } },
  });
  if (!att) return new Response("없습니다.", { status: 404 });
  const role = resolveSpaceRole(actor, att.space.visibility, att.space.permissions);
  if (!hasRole(role, "viewer")) return new Response("없습니다.", { status: 404 });
  // ... 이하 스트리밍/헤더 로직은 기존 그대로 유지 (수정 금지)
```

주의: 함수 시그니처의 `_req` → `req`로 변경(이제 사용함). 스트리밍·Content-Disposition·CSP 헤더 블록은 손대지 않는다.

- [ ] **Step 3: e2e 테스트 추가 (실패 확인 → 구현 후 통과가 아니라, 라우트 수정과 함께 커밋되므로 바로 통과 확인)**

`e2e/wiki.spec.ts` 파일 끝에 추가:

```ts
test("API 토큰으로 첨부 업로드/다운로드", async ({ page, request }) => {
  await login(page, "alice", "alice1234");

  // 토큰 발급 — 원문은 발급 직후 한 번만 노출된다(data-testid="new-token")
  await page.goto("/settings/tokens");
  await page.locator('input[name="name"]').fill("e2e-attach");
  await page.getByRole("button", { name: "토큰 발급" }).click();
  const raw = (await page.getByTestId("new-token").textContent())!.trim();
  expect(raw).toMatch(/^swk_/);

  try {
    // request 픽스처는 브라우저 쿠키와 무관 → 순수 토큰 인증 경로 검증
    const body = Buffer.from("mcp attachment e2e " + Date.now());
    const up = await request.post("/api/spaces/eng/attachments", {
      headers: { Authorization: `Bearer ${raw}` },
      multipart: { file: { name: "e2e-attach.txt", mimeType: "text/plain", buffer: body } },
    });
    expect(up.status()).toBe(200);
    const meta = await up.json();
    expect(meta.url).toMatch(/^\/api\/attachments\//);
    expect(meta.filename).toBe("e2e-attach.txt");

    const down = await request.get(meta.url, { headers: { Authorization: `Bearer ${raw}` } });
    expect(down.status()).toBe(200);
    expect(await down.body()).toEqual(body);

    // 무인증(쿠키도 토큰도 없음)이면 401
    const anon = await request.post("/api/spaces/eng/attachments", {
      multipart: { file: { name: "x.txt", mimeType: "text/plain", buffer: Buffer.from("x") } },
    });
    expect(anon.status()).toBe(401);
  } finally {
    // 토큰 정리(행 누적 방지)
    await page.goto("/settings/tokens");
    page.once("dialog", (d) => d.accept());
    await page
      .locator("tr", { hasText: "e2e-attach" })
      .first()
      .getByRole("button", { name: "삭제" })
      .click();
    await expect(page.locator("tr", { hasText: "e2e-attach" })).toHaveCount(0);
  }
});
```

- [ ] **Step 4: 검증 실행**

```bash
npx tsc --noEmit                                            # 기대: 무출력, exit 0
npx playwright test e2e/wiki.spec.ts -g "API 토큰으로 첨부" --reporter=line   # 기대: 1 passed
```

- [ ] **Step 5: 커밋**

```bash
git add "src/app/api/spaces/[spaceKey]/attachments/route.ts" "src/app/api/attachments/[id]/route.ts" e2e/wiki.spec.ts
git commit -m "feat(api): 첨부 업로드/다운로드에 API 토큰 인증 허용" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: mcp-server upload_attachment 도구 (v1.4.0)

**Files:**
- Modify: `mcp-server/src/tools.ts` (api 헬퍼 수정 + 도구 추가 + INSTRUCTIONS + 버전)
- Modify: `mcp-server/package.json` (버전 1.4.0)

**Interfaces:**
- Consumes: Task 1의 토큰 인증 업로드 API `POST /api/spaces/{key}/attachments` (multipart, 필드명 `file`).
- Produces: MCP 도구 `upload_attachment(space, path, filename?)`.

- [ ] **Step 1: api() 헬퍼 — JSON Content-Type을 문자열 body일 때만**

`mcp-server/src/tools.ts`의 `api()` 안 headers를 수정:

```ts
      headers: {
        Authorization: `Bearer ${token}`,
        // FormData는 fetch가 boundary 포함 multipart 헤더를 스스로 설정해야 한다.
        ...(typeof init?.body === "string" ? { "Content-Type": "application/json" } : {}),
        ...(init?.headers ?? {}),
      },
```

- [ ] **Step 2: 파일 상단 import + MIME 매핑 추가**

```ts
import { promises as fs } from "node:fs";
import { basename, extname } from "node:path";
```

`toResult` 아래에:

```ts
const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;

const MIME_BY_EXT: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".pdf": "application/pdf",
  ".txt": "text/plain",
  ".md": "text/markdown",
  ".csv": "text/csv",
  ".json": "application/json",
  ".zip": "application/zip",
  ".mp4": "video/mp4",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
};

function mimeFor(name: string): string {
  return MIME_BY_EXT[extname(name).toLowerCase()] ?? "application/octet-stream";
}
```

- [ ] **Step 3: upload_attachment 도구 등록 (delete_page 다음에)**

```ts
  server.registerTool(
    "upload_attachment",
    {
      title: "첨부파일 업로드",
      description:
        "로컬 파일을 스페이스 첨부로 업로드합니다(editor 권한, 20MB 이하). path는 이 MCP 서버가 실행 중인 머신의 파일 경로입니다(원격 HTTP 모드라면 그 서버 머신 기준). 반환된 url을 마크다운으로 본문에 삽입하세요.",
      inputSchema: {
        space: z.string().describe("스페이스 키"),
        path: z.string().describe("업로드할 파일의 절대 경로 (MCP 서버 머신 기준)"),
        filename: z.string().optional().describe("저장할 파일명 (생략 시 경로의 파일명)"),
      },
    },
    async ({ space, path: filePath, filename }) => {
      const fail = (text: string) => ({ content: [{ type: "text" as const, text }], isError: true });
      let stat;
      try {
        stat = await fs.stat(filePath);
      } catch {
        return fail(`파일을 찾을 수 없습니다: ${filePath}`);
      }
      if (!stat.isFile()) return fail(`파일이 아닙니다: ${filePath}`);
      if (stat.size > MAX_UPLOAD_BYTES) {
        return fail(`20MB 이하만 업로드할 수 있습니다 (${(stat.size / 1024 / 1024).toFixed(1)}MB)`);
      }

      const name = filename ?? basename(filePath);
      const mime = mimeFor(name);
      const form = new FormData();
      form.append("file", new Blob([new Uint8Array(await fs.readFile(filePath))], { type: mime }), name);
      const r = await api(`/api/spaces/${encodeURIComponent(space)}/attachments`, {
        method: "POST",
        body: form,
      });
      if (!r.ok) return toResult(r);
      const data = r.data as { id: string; url: string; filename: string };
      const md = mime.startsWith("image/")
        ? `![${data.filename}](${data.url})`
        : `[${data.filename}](${data.url})`;
      return {
        content: [
          {
            type: "text" as const,
            text: `업로드 완료: ${JSON.stringify(data)}\n본문 삽입 예: ${md}`,
          },
        ],
      };
    },
  );
```

- [ ] **Step 4: SERVER_INSTRUCTIONS에 첨부 섹션 추가 ("규칙:" 앞에)**

```
첨부:
- upload_attachment(space, path)로 파일을 올립니다. path는 이 MCP 서버가 실행 중인 머신의 경로이며 20MB 이하만 가능합니다.
- 반환된 url을 마크다운으로 본문에 삽입합니다: 이미지는 ![이름](url), 그 외는 [이름](url) (append_to_page/replace_in_page 사용).
```

- [ ] **Step 5: 버전 1.4.0**

- `mcp-server/src/tools.ts`: `{ name: "simple-wiki", version: "1.3.0" }` → `"1.4.0"`
- `mcp-server/package.json`: `"version": "1.3.0"` → `"1.4.0"`

- [ ] **Step 6: 빌드 + 스모크 (라이브 dev 서버 대상)**

```bash
cd mcp-server && npm run build          # 기대: exit 0
```

스모크용 토큰을 dev DB에 직접 만든다(끝나면 삭제):

```bash
node -e '
const { createHash, randomBytes } = require("node:crypto");
const raw = "swk_" + randomBytes(32).toString("base64url");
const hash = createHash("sha256").update(raw).digest("hex");
console.log(raw); console.log(hash); console.log(raw.slice(0, 12));
'
# 출력의 hash/prefix로:
docker exec simple-wiki-postgres-1 psql -U wiki -d wiki -c \
  "INSERT INTO \"ApiToken\" (id, \"userId\", name, \"tokenHash\", prefix) SELECT 'smoke-attach-token', id, 'smoke-attach', '<hash>', '<prefix>' FROM \"User\" WHERE username='alice';"
```

스모크 스크립트(스크래치패드에 작성, 커밋 금지) `mcp-upload-smoke.mjs`:

```js
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { writeFileSync } from "node:fs";

const [token, mcpDir, tmpFile] = process.argv.slice(2);
writeFileSync(tmpFile, "mcp upload smoke " + new Date().toISOString());
const transport = new StdioClientTransport({
  command: "node",
  args: [mcpDir + "/dist/index.js"],
  env: { ...process.env, WIKI_API_TOKEN: token, WIKI_BASE_URL: "http://localhost:3000" },
});
const client = new Client({ name: "smoke", version: "0.0.0" });
await client.connect(transport);
const res = await client.callTool({
  name: "upload_attachment",
  arguments: { space: "eng", path: tmpFile },
});
console.log(JSON.stringify(res, null, 2));
await client.close();
```

실행·기대:

```bash
cd mcp-server && node <scratchpad>/mcp-upload-smoke.mjs <raw토큰> "$PWD" <scratchpad>/smoke.txt
# 기대: isError 없음, "업로드 완료: {"id":..., "url":"/api/attachments/...", "filename":"smoke.txt"}" 출력
curl -s -H "Authorization: Bearer <raw토큰>" http://localhost:3000<url>   # 기대: 파일 내용 그대로
docker exec simple-wiki-postgres-1 psql -U wiki -d wiki -c "DELETE FROM \"ApiToken\" WHERE id='smoke-attach-token';"
```

- [ ] **Step 7: 커밋**

```bash
git add mcp-server/src/tools.ts mcp-server/package.json
git commit -m "feat(mcp): upload_attachment 도구 — 로컬 파일을 첨부로 업로드 (v1.4.0)" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```
