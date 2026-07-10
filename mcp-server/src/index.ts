#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

// 설정: 위키 주소와 개인 액세스 토큰(앱의 /settings/tokens 에서 발급)
const BASE = (process.env.WIKI_BASE_URL ?? "http://localhost:3000").replace(/\/$/, "");
const TOKEN = process.env.WIKI_API_TOKEN;

if (!TOKEN) {
  // stderr로만 로그(stdout은 JSON-RPC 채널이라 오염 금지)
  console.error("환경변수 WIKI_API_TOKEN이 필요합니다. 앱의 /settings/tokens 에서 발급하세요.");
  process.exit(1);
}

interface ApiResult {
  ok: boolean;
  status: number;
  data: unknown;
}

async function api(path: string, init?: RequestInit): Promise<ApiResult> {
  const res = await fetch(BASE + path, {
    ...init,
    headers: {
      Authorization: `Bearer ${TOKEN}`,
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

function toResult(r: ApiResult) {
  const body = typeof r.data === "string" ? r.data : JSON.stringify(r.data, null, 2);
  return {
    content: [{ type: "text" as const, text: r.ok ? body : `요청 실패 (HTTP ${r.status})\n${body}` }],
    isError: !r.ok,
  };
}

const server = new McpServer({ name: "simple-wiki", version: "1.0.0" });

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

const transport = new StdioServerTransport();
await server.connect(transport);
console.error(`simple-wiki MCP 서버 시작 (${BASE})`);
