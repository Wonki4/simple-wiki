import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { promises as fs } from "node:fs";
import { basename, extname } from "node:path";

// ── 서버 사용 지침 (MCP initialize 응답의 instructions로 호스트에 전달된다) ──
// 모델이 도구를 올바른 순서로 조합해 쓰도록 유도한다.
export const SERVER_INSTRUCTIONS = `이 서버는 사내 마크다운 위키(simple-wiki)를 읽고 씁니다.

권장 흐름:
1. 무엇이 있는지 모르면 list_spaces로 접근 가능한 스페이스를 확인합니다.
2. 특정 내용을 찾을 땐 search_pages(제목·본문 전문검색, 스니펫 반환)를 먼저 씁니다.
3. 문서 원문이 필요하면 get_page(space, slug) — 응답의 version을 기억합니다.
4. 새 문서는 create_page, 같은 제목이 있으면 409 → update_page로 전환합니다.

안전한 편집(중요):
- 수정 전에 get_page로 현재 version을 확인하고, update_page/append_to_page/replace_in_page/revert_page 호출 시 expectedVersion으로 그 값을 넘깁니다.
- 응답이 409(conflict)면 다른 사람이 그사이 수정한 것입니다. get_page로 다시 읽고 병합한 뒤 최신 version으로 재시도합니다. 절대 그냥 덮어쓰지 마세요.
- 한 줄~한 문단만 고칠 땐 update_page(전체 교체) 대신 append_to_page(끝에 추가) 또는 replace_in_page(정확히 1곳 치환)를 씁니다. 토큰을 아끼고 실수로 다른 내용을 지우지 않습니다.
- replace_in_page의 old_string은 문서에서 정확히 1곳에만 매치돼야 합니다. 여러 곳이면 더 긴 고유 문맥을 포함하세요.

이력:
- get_page_history(space, slug)로 리비전 목록(version/작성자/시각/출처)을 봅니다.
- 특정 버전 원문은 get_page(space, slug, version)로 읽습니다.
- revert_page(space, slug, version)는 과거 버전 내용을 새 리비전으로 복원합니다(이력은 보존).

트리:
- 문서는 스페이스 안에서 부모-자식 트리를 이룹니다. list_pages의 들여쓰기가 구조입니다.
- 새 문서를 만들 때 관련 상위 문서가 있으면 create_page의 parent로 그 slug를 지정하세요.
- move_page로 위치를 바꿀 수 있습니다. 이동해도 slug/링크는 변하지 않습니다.

첨부:
- upload_attachment로 파일을 올립니다. 입력은 path(MCP 서버 머신의 파일 경로)·content_base64(파일 내용, 4MB 이하)·url(서버가 내려받을 http(s) 주소, 20MB 이하) 중 정확히 하나입니다.
- 원격(HTTP) 모드에서는 사용자의 로컬 파일 경로가 서버에 보이지 않습니다 — content_base64나 url을 쓰세요.
- 반환된 url을 마크다운으로 본문에 삽입합니다: 이미지는 ![이름](url), 그 외는 [이름](url) (append_to_page/replace_in_page 사용).

규칙:
- 권한은 토큰 소유자의 스페이스 권한을 따릅니다. 읽을 수 없는 스페이스는 목록·조회 모두 404로 숨겨집니다.
- 문서 사이 링크는 위키링크 문법 [[문서 제목]]을 씁니다.
- delete_page는 되돌릴 수 없으니 사용자가 명시적으로 요청할 때만 사용합니다.`;

interface ApiResult {
  ok: boolean;
  status: number;
  data: unknown;
}

function toResult(r: ApiResult) {
  const body = typeof r.data === "string" ? r.data : JSON.stringify(r.data, null, 2);
  return {
    content: [{ type: "text" as const, text: r.ok ? body : `요청 실패 (HTTP ${r.status})\n${body}` }],
    isError: !r.ok,
  };
}

const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;
// content_base64는 모델 컨텍스트를 통과하므로 서버 상한(20MB)보다 훨씬 작게 잡는다.
const MAX_CONTENT_BYTES = 4 * 1024 * 1024;

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

/**
 * 주어진 토큰·주소로 위키 API를 호출하는 MCP 서버를 만든다.
 * stdio(단일 사용자 env 토큰)와 HTTP(요청별 헤더 토큰) 양쪽에서 재사용한다.
 */
export function createWikiMcpServer(token: string, baseUrl: string): McpServer {
  const base = baseUrl.replace(/\/$/, "");

  async function api(path: string, init?: RequestInit): Promise<ApiResult> {
    const res = await fetch(base + path, {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        // FormData는 fetch가 boundary 포함 multipart 헤더를 스스로 설정해야 한다.
        ...(typeof init?.body === "string" ? { "Content-Type": "application/json" } : {}),
        ...(init?.headers ?? {}),
      },
    });
    const text = await res.text();
    let data: unknown = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = text;
    }
    return { ok: res.ok, status: res.status, data };
  }

  const server = new McpServer(
    { name: "simple-wiki", version: "1.5.0" },
    { instructions: SERVER_INSTRUCTIONS },
  );

  server.registerTool(
    "list_spaces",
    {
      title: "스페이스 목록",
      description:
        "토큰 사용자가 읽을 수 있는 위키 스페이스 목록과 각 스페이스에서의 역할(viewer/editor/admin)을 반환합니다.",
      inputSchema: {},
    },
    async () => toResult(await api("/api/spaces")),
  );

  server.registerTool(
    "list_pages",
    {
      title: "페이지 목록",
      description:
        "특정 스페이스의 페이지 트리를 반환합니다. 들여쓰기가 부모-자식 관계이며, 각 항목에 slug와 parentSlug가 있습니다.",
      inputSchema: { space: z.string().describe("스페이스 키 (예: eng). list_spaces의 key 값)") },
    },
    async ({ space }) => {
      const r = await api(`/api/spaces/${encodeURIComponent(space)}/pages`);
      if (!r.ok) return toResult(r);
      const data = r.data as {
        space: unknown;
        pages: { slug: string; title: string; parentSlug: string | null }[];
      };
      // 들여쓰기 트리 텍스트 구성 (형제는 API 순서 = 제목순)
      const children = new Map<string | null, typeof data.pages>();
      for (const p of data.pages) {
        const key = p.parentSlug ?? null;
        const arr = children.get(key) ?? [];
        arr.push(p);
        children.set(key, arr);
      }
      const lines: string[] = [];
      const walk = (parent: string | null, depth: number) => {
        for (const p of children.get(parent) ?? []) {
          lines.push(`${"  ".repeat(depth)}- ${p.title} (slug: ${p.slug})`);
          walk(p.slug, depth + 1);
        }
      };
      walk(null, 0);
      return { content: [{ type: "text" as const, text: JSON.stringify(data.space) + "\n" + lines.join("\n") }] };
    },
  );

  server.registerTool(
    "search_pages",
    {
      title: "위키 검색",
      description:
        "제목·본문 전문 검색. 읽을 수 있는 스페이스만 검색되며, 결과마다 스페이스 키/slug/제목/스니펫을 반환합니다.",
      inputSchema: { query: z.string().describe("검색어") },
    },
    async ({ query }) => toResult(await api(`/api/search?q=${encodeURIComponent(query)}`)),
  );

  server.registerTool(
    "get_page",
    {
      title: "페이지 읽기",
      description:
        "페이지의 마크다운 원문과 현재 version을 반환합니다. version 인자를 주면 그 리비전의 원문을 반환합니다. slug는 list_pages/search_pages 결과의 slug를 사용하세요.",
      inputSchema: {
        space: z.string().describe("스페이스 키"),
        slug: z.string().describe("페이지 slug"),
        version: z.number().int().positive().optional().describe("특정 리비전 번호(생략 시 최신)"),
      },
    },
    async ({ space, slug, version }) => {
      const qs = version ? `?version=${version}` : "";
      return toResult(
        await api(`/api/spaces/${encodeURIComponent(space)}/pages/${encodeURIComponent(slug)}${qs}`),
      );
    },
  );

  server.registerTool(
    "create_page",
    {
      title: "페이지 생성",
      description:
        "새 마크다운 페이지를 만듭니다(editor 권한 필요). slug는 제목에서 자동 생성됩니다. 같은 제목이 있으면 실패(409)합니다.",
      inputSchema: {
        space: z.string().describe("스페이스 키"),
        title: z.string().describe("페이지 제목"),
        content: z.string().optional().describe("마크다운 본문 (생략 시 빈 문서)"),
        parent: z.string().optional().describe("부모 페이지 slug(생략 시 최상위). 페이지 트리의 위치를 정합니다."),
      },
    },
    async ({ space, title, content, parent }) =>
      toResult(
        await api(`/api/spaces/${encodeURIComponent(space)}/pages`, {
          method: "POST",
          body: JSON.stringify({ title, content: content ?? "", parent }),
        }),
      ),
  );

  server.registerTool(
    "update_page",
    {
      title: "페이지 수정",
      description:
        "기존 페이지 전체 본문을 교체합니다(editor 권한). expectedVersion을 주면 그사이 변경 시 409로 실패합니다. 새 리비전이 이력에 남습니다.",
      inputSchema: {
        space: z.string().describe("스페이스 키"),
        slug: z.string().describe("수정할 페이지 slug"),
        title: z.string().describe("페이지 제목"),
        content: z.string().optional().describe("교체할 마크다운 본문 전체"),
        expectedVersion: z.number().int().positive().optional().describe("get_page로 읽은 현재 version"),
      },
    },
    async ({ space, slug, title, content, expectedVersion }) =>
      toResult(
        await api(`/api/spaces/${encodeURIComponent(space)}/pages/${encodeURIComponent(slug)}`, {
          method: "PUT",
          body: JSON.stringify({ title, content: content ?? "", expectedVersion }),
        }),
      ),
  );

  server.registerTool(
    "get_page_history",
    {
      title: "변경 이력",
      description: "페이지의 리비전 목록(version/제목/작성자/출처/시각)을 최신순으로 반환합니다. 본문은 포함하지 않으니 특정 버전 원문은 get_page(version)로 읽으세요.",
      inputSchema: {
        space: z.string().describe("스페이스 키"),
        slug: z.string().describe("페이지 slug"),
      },
    },
    async ({ space, slug }) =>
      toResult(
        await api(`/api/spaces/${encodeURIComponent(space)}/pages/${encodeURIComponent(slug)}/revisions`),
      ),
  );

  server.registerTool(
    "append_to_page",
    {
      title: "본문 이어붙이기",
      description: "페이지 본문 끝에 마크다운을 덧붙입니다(editor 권한). 전체 재작성 없이 안전하게 추가합니다. expectedVersion 권장.",
      inputSchema: {
        space: z.string().describe("스페이스 키"),
        slug: z.string().describe("페이지 slug"),
        content: z.string().describe("덧붙일 마크다운"),
        expectedVersion: z.number().int().positive().optional().describe("get_page로 읽은 현재 version"),
      },
    },
    async ({ space, slug, content, expectedVersion }) =>
      toResult(
        await api(`/api/spaces/${encodeURIComponent(space)}/pages/${encodeURIComponent(slug)}/append`, {
          method: "POST",
          body: JSON.stringify({ content, expectedVersion }),
        }),
      ),
  );

  server.registerTool(
    "replace_in_page",
    {
      title: "본문 부분 치환",
      description: "old_string을 문서에서 정확히 1곳 찾아 new_string으로 바꿉니다(editor 권한). 여러 곳 매치면 실패하니 고유한 문맥을 포함하세요. expectedVersion 권장.",
      inputSchema: {
        space: z.string().describe("스페이스 키"),
        slug: z.string().describe("페이지 slug"),
        old_string: z.string().describe("바꿀 기존 문자열(정확히 1곳 매치)"),
        new_string: z.string().describe("새 문자열"),
        expectedVersion: z.number().int().positive().optional().describe("get_page로 읽은 현재 version"),
      },
    },
    async ({ space, slug, old_string, new_string, expectedVersion }) =>
      toResult(
        await api(`/api/spaces/${encodeURIComponent(space)}/pages/${encodeURIComponent(slug)}/replace`, {
          method: "POST",
          body: JSON.stringify({ old_string, new_string, expectedVersion }),
        }),
      ),
  );

  server.registerTool(
    "revert_page",
    {
      title: "이전 버전으로 복원",
      description: "과거 리비전 version의 내용을 새 리비전으로 복원합니다(editor 권한). 이력은 삭제되지 않습니다. expectedVersion 권장.",
      inputSchema: {
        space: z.string().describe("스페이스 키"),
        slug: z.string().describe("페이지 slug"),
        version: z.number().int().positive().describe("복원할 과거 리비전 번호"),
        expectedVersion: z.number().int().positive().optional().describe("현재 version(충돌 방지)"),
      },
    },
    async ({ space, slug, version, expectedVersion }) =>
      toResult(
        await api(`/api/spaces/${encodeURIComponent(space)}/pages/${encodeURIComponent(slug)}/revert`, {
          method: "POST",
          body: JSON.stringify({ version, expectedVersion }),
        }),
      ),
  );

  server.registerTool(
    "move_page",
    {
      title: "페이지 이동",
      description:
        "페이지를 트리에서 이동합니다(editor 권한). parent에 부모 slug를 주거나, 최상위로 옮기려면 생략합니다. 자기 자신/하위로는 이동할 수 없습니다(422).",
      inputSchema: {
        space: z.string().describe("스페이스 키"),
        slug: z.string().describe("이동할 페이지 slug"),
        parent: z.string().optional().describe("부모 페이지 slug(생략 시 최상위)"),
      },
    },
    async ({ space, slug, parent }) =>
      toResult(
        await api(
          `/api/spaces/${encodeURIComponent(space)}/pages/${encodeURIComponent(slug)}/move`,
          { method: "POST", body: JSON.stringify({ parent: parent ?? null }) },
        ),
      ),
  );

  server.registerTool(
    "delete_page",
    {
      title: "페이지 삭제",
      description: "페이지를 삭제합니다(editor 권한). 되돌릴 수 없습니다.",
      inputSchema: {
        space: z.string().describe("스페이스 키"),
        slug: z.string().describe("삭제할 페이지 slug"),
      },
    },
    async ({ space, slug }) =>
      toResult(
        await api(`/api/spaces/${encodeURIComponent(space)}/pages/${encodeURIComponent(slug)}`, {
          method: "DELETE",
        }),
      ),
  );

  server.registerTool(
    "upload_attachment",
    {
      title: "첨부파일 업로드",
      description:
        "파일을 스페이스 첨부로 업로드합니다(editor 권한, 20MB 이하). 입력은 path·content_base64·url 중 정확히 하나: path는 이 MCP 서버가 실행 중인 머신의 파일 경로(로컬 stdio 실행일 때만 유효), content_base64는 파일 내용 자체(디코드 후 4MB 이하), url은 MCP 서버가 접근 가능한 http(s) 리소스를 서버가 내려받아 올립니다. 반환된 url을 마크다운으로 본문에 삽입하세요.",
      inputSchema: {
        space: z.string().describe("스페이스 키"),
        path: z.string().optional().describe("MCP 서버 머신의 파일 절대 경로 (로컬 stdio 모드용)"),
        content_base64: z.string().optional().describe("파일 내용의 base64 인코딩 (디코드 후 4MB 이하)"),
        url: z.string().optional().describe("내려받을 http(s) URL — MCP 서버의 네트워크에서 접근 가능해야 함 (20MB·15초 제한)"),
        filename: z
          .string()
          .optional()
          .describe("저장할 파일명. content_base64면 필수, path/url은 생략 시 경로에서 유도"),
      },
    },
    async ({ space, path: filePath, content_base64, url, filename }) => {
      const fail = (text: string) => ({ content: [{ type: "text" as const, text }], isError: true });
      const given = [filePath, content_base64, url].filter((v) => v !== undefined);
      if (given.length !== 1) {
        return fail("path, content_base64, url 중 정확히 하나만 지정하세요.");
      }

      let bytes: Uint8Array;
      let name: string;
      let mime: string | undefined;

      if (filePath !== undefined) {
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
        bytes = new Uint8Array(await fs.readFile(filePath));
        name = filename ?? basename(filePath);
      } else if (content_base64 !== undefined) {
        if (!filename) return fail("content_base64 업로드에는 filename이 필요합니다.");
        // 디코드 전에 문자열 길이로 상한을 걸어 거대 입력의 디코드 자체를 피한다 (base64는 원본의 4/3).
        if (content_base64.length > (MAX_CONTENT_BYTES / 3) * 4 + 4) {
          return fail(`content_base64는 디코드 후 ${MAX_CONTENT_BYTES / 1024 / 1024}MB 이하만 가능합니다.`);
        }
        bytes = new Uint8Array(Buffer.from(content_base64, "base64"));
        if (bytes.length === 0) return fail("content_base64를 디코드한 결과가 비어 있습니다.");
        if (bytes.length > MAX_CONTENT_BYTES) {
          return fail(`content_base64는 디코드 후 ${MAX_CONTENT_BYTES / 1024 / 1024}MB 이하만 가능합니다.`);
        }
        name = filename;
      } else {
        let parsed: URL;
        try {
          parsed = new URL(url as string);
        } catch {
          return fail(`URL이 올바르지 않습니다: ${url}`);
        }
        if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
          return fail("http(s) URL만 지원합니다.");
        }
        let res: Response;
        try {
          res = await fetch(parsed, { signal: AbortSignal.timeout(15_000), redirect: "follow" });
        } catch (e) {
          return fail(`URL을 내려받지 못했습니다: ${e instanceof Error ? e.message : String(e)}`);
        }
        if (!res.ok) return fail(`URL 응답이 실패했습니다 (HTTP ${res.status}).`);
        const declared = Number(res.headers.get("content-length") ?? 0);
        if (declared > MAX_UPLOAD_BYTES) {
          return fail(`20MB 이하만 업로드할 수 있습니다 (content-length ${(declared / 1024 / 1024).toFixed(1)}MB)`);
        }
        if (!res.body) return fail("URL 응답 본문이 없습니다.");
        // content-length가 없거나 거짓일 수 있으니 스트림을 읽으며 상한을 강제한다.
        const reader = res.body.getReader();
        const chunks: Uint8Array[] = [];
        let size = 0;
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          size += value.length;
          if (size > MAX_UPLOAD_BYTES) {
            await reader.cancel();
            return fail("20MB 이하만 업로드할 수 있습니다 (응답이 상한 초과).");
          }
          chunks.push(value);
        }
        bytes = new Uint8Array(size);
        let off = 0;
        for (const c of chunks) {
          bytes.set(c, off);
          off += c.length;
        }
        const urlName = basename(parsed.pathname);
        name = filename ?? (urlName || "attachment");
        const ct = res.headers.get("content-type")?.split(";")[0].trim();
        if (ct) mime = ct;
      }

      mime = mime ?? mimeFor(name);
      const form = new FormData();
      // 복사 생성으로 ArrayBuffer 기반 Uint8Array를 보장한다(BlobPart 타입 요구).
      form.append("file", new Blob([new Uint8Array(bytes)], { type: mime }), name);
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

  return server;
}
