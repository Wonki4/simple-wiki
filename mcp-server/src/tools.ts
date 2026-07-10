import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

// ── 서버 사용 지침 (MCP initialize 응답의 instructions로 호스트에 전달된다) ──
// 모델이 도구를 올바른 순서로 조합해 쓰도록 유도한다.
export const SERVER_INSTRUCTIONS = `이 서버는 사내 마크다운 위키(simple-wiki)를 읽고 씁니다.

권장 흐름:
1. 무엇이 있는지 모르면 list_spaces로 접근 가능한 스페이스를 확인합니다.
2. 특정 내용을 찾을 땐 search_pages(제목·본문 전문검색, 스니펫 반환)를 먼저 씁니다. 스페이스 전체를 훑는 것보다 토큰 효율적입니다.
3. 문서 원문이 필요하면 get_page(space, slug) — slug는 반드시 list_pages/search_pages 결과의 slug 값을 사용합니다.
4. 새 문서는 create_page로 만들되, 같은 제목이 있으면 409로 실패하니 그 경우 update_page로 전환합니다.
5. 기존 문서 수정은 update_page이며 content는 문서 전체를 교체합니다(부분 패치가 아님). 매 수정은 새 리비전으로 이력에 남습니다.

규칙:
- 권한은 토큰 소유자의 스페이스 권한(viewer/editor/admin)을 그대로 따릅니다. 읽을 수 없는 스페이스는 목록·조회 모두 404로 숨겨집니다.
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
        ...(init?.body ? { "Content-Type": "application/json" } : {}),
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
    { name: "simple-wiki", version: "1.1.0" },
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
      description: "특정 스페이스의 페이지 목록(제목/slug/수정시각)을 반환합니다.",
      inputSchema: { space: z.string().describe("스페이스 키 (예: eng). list_spaces의 key 값)") },
    },
    async ({ space }) => toResult(await api(`/api/spaces/${encodeURIComponent(space)}/pages`)),
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
        "페이지의 마크다운 원문을 반환합니다. slug는 list_pages 결과의 slug 값을 사용하세요.",
      inputSchema: {
        space: z.string().describe("스페이스 키"),
        slug: z.string().describe("페이지 slug (list_pages 결과)"),
      },
    },
    async ({ space, slug }) =>
      toResult(await api(`/api/spaces/${encodeURIComponent(space)}/pages/${encodeURIComponent(slug)}`)),
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
      },
    },
    async ({ space, title, content }) =>
      toResult(
        await api(`/api/spaces/${encodeURIComponent(space)}/pages`, {
          method: "POST",
          body: JSON.stringify({ title, content: content ?? "" }),
        }),
      ),
  );

  server.registerTool(
    "update_page",
    {
      title: "페이지 수정",
      description:
        "기존 페이지를 수정합니다(editor 권한). slug는 유지되고 새 리비전이 이력에 저장됩니다. content는 전체 본문으로 대체됩니다.",
      inputSchema: {
        space: z.string().describe("스페이스 키"),
        slug: z.string().describe("수정할 페이지 slug"),
        title: z.string().describe("페이지 제목"),
        content: z.string().optional().describe("교체할 마크다운 본문 전체"),
      },
    },
    async ({ space, slug, title, content }) =>
      toResult(
        await api(`/api/spaces/${encodeURIComponent(space)}/pages/${encodeURIComponent(slug)}`, {
          method: "PUT",
          body: JSON.stringify({ title, content: content ?? "" }),
        }),
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

  return server;
}
