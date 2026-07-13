#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createWikiMcpServer } from "./tools.js";

// 설정: 위키 주소와 개인 액세스 토큰(앱의 /settings/tokens 에서 발급)
const BASE = process.env.WIKI_BASE_URL ?? "http://localhost:3000";
const TOKEN = process.env.WIKI_API_TOKEN;

if (!TOKEN) {
  // stderr로만 로그(stdout은 JSON-RPC 채널이라 오염 금지)
  console.error("환경변수 WIKI_API_TOKEN이 필요합니다. 앱의 /settings/tokens 에서 발급하세요.");
  process.exit(1);
}

const server = createWikiMcpServer(TOKEN, BASE);
const transport = new StdioServerTransport();
await server.connect(transport);
console.error(`simple-wiki MCP 서버(stdio) 시작 (${BASE.replace(/\/$/, "")})`);
