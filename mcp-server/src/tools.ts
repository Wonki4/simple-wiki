import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

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
    { name: "simple-wiki", version: "1.2.0" },
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
