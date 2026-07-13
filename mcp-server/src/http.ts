#!/usr/bin/env node
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createWikiMcpServer } from "./tools.js";

// 원격(다중 사용자) 모드: 각 MCP 클라이언트가 Authorization 헤더로 자신의 PAT를 보낸다.
// 서버는 그 토큰을 위키 API로 그대로 전달하므로, 접근 권한은 토큰 소유자를 따른다.
const BASE = process.env.WIKI_BASE_URL ?? "http://localhost:3000";
const PORT = Number(process.env.PORT ?? 3333);
// 기본은 loopback(127.0.0.1). LAN/공개 노출은 배포 시 HOST=0.0.0.0 로 명시적으로 여는 것을 강제한다.
const HOST = process.env.HOST ?? "127.0.0.1";
const MCP_PATH = process.env.MCP_PATH ?? "/mcp";
const MAX_BODY_BYTES = 4_000_000;
// 헤더 없는 클라이언트를 위한 선택적 기본 토큰(단일 사용자 배포용). 없어도 됨.
const FALLBACK_TOKEN = process.env.WIKI_API_TOKEN;
// CORS는 기본 비활성. 브라우저 기반 클라이언트를 붙일 때만 오리진을 명시적으로 허용한다.
// (Claude Desktop/Code 등은 브라우저가 아니므로 CORS 불필요.)
const ALLOW_ORIGIN = process.env.MCP_ALLOW_ORIGIN;
// DNS 리바인딩 보호: 허용 호스트를 지정하면 활성화된다.
const ALLOWED_HOSTS = process.env.MCP_ALLOWED_HOSTS?.split(",").map((s) => s.trim()).filter(Boolean);

// 요청 오리진이 허용될 때만 CORS 헤더를 붙인다. 와일드카드(*)는 운영자가 명시적으로 선택한 경우만.
function applyCors(req: IncomingMessage, res: ServerResponse) {
  if (!ALLOW_ORIGIN) return;
  const origin = typeof req.headers.origin === "string" ? req.headers.origin : undefined;
  let allow: string | undefined;
  if (ALLOW_ORIGIN === "*") allow = "*";
  else if (origin && origin === ALLOW_ORIGIN) allow = origin;
  if (!allow) return;
  res.setHeader("Access-Control-Allow-Origin", allow);
  if (allow !== "*") res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization, Mcp-Session-Id, Mcp-Protocol-Version",
  );
  res.setHeader("Access-Control-Expose-Headers", "Mcp-Session-Id");
}

function sendJson(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

function bearerToken(req: IncomingMessage): string | undefined {
  const auth = req.headers["authorization"];
  if (typeof auth === "string" && auth.startsWith("Bearer ")) return auth.slice(7).trim();
  return FALLBACK_TOKEN;
}

// 바이트 단위로 상한을 강제하고, 초과 시 소켓을 파괴해 버퍼링을 즉시 중단한다.
function readBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let aborted = false;
    req.on("data", (chunk: Buffer) => {
      if (aborted) return;
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        aborted = true;
        req.destroy();
        reject(new Error("본문이 너무 큽니다."));
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      if (aborted) return;
      if (!chunks.length) return resolve(undefined);
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch {
        reject(new Error("JSON 본문이 올바르지 않습니다."));
      }
    });
    req.on("error", (e) => {
      if (!aborted) reject(e);
    });
  });
}

const httpServer = createServer(async (req, res) => {
  applyCors(req, res);
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);

  if (req.method === "OPTIONS") {
    res.writeHead(204).end();
    return;
  }

  // 헬스체크
  if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/health")) {
    sendJson(res, 200, { ok: true, service: "simple-wiki-mcp", transport: "streamable-http", wiki: BASE });
    return;
  }

  if (url.pathname !== MCP_PATH) {
    sendJson(res, 404, { error: "not found" });
    return;
  }

  // 무상태(stateless) 모드: 세션 없이 요청마다 서버/트랜스포트를 새로 만든다.
  // GET(SSE 스트림)·DELETE(세션 종료)는 무상태에선 필요 없다.
  if (req.method !== "POST") {
    sendJson(res, 405, {
      jsonrpc: "2.0",
      error: { code: -32000, message: "이 엔드포인트는 POST(JSON-RPC)만 지원합니다." },
      id: null,
    });
    return;
  }

  const token = bearerToken(req);
  if (!token) {
    sendJson(res, 401, {
      jsonrpc: "2.0",
      error: { code: -32001, message: "Authorization: Bearer <PAT> 헤더가 필요합니다." },
      id: null,
    });
    return;
  }

  let body: unknown;
  try {
    body = await readBody(req);
  } catch (e) {
    // 초과 본문은 소켓을 파괴했을 수 있으므로 살아있을 때만 400을 보낸다.
    if (!res.headersSent && !res.destroyed) {
      sendJson(res, 400, {
        jsonrpc: "2.0",
        error: { code: -32700, message: e instanceof Error ? e.message : "본문 파싱 실패" },
        id: null,
      });
    }
    return;
  }

  const server = createWikiMcpServer(token, BASE);
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
    ...(ALLOWED_HOSTS?.length
      ? { enableDnsRebindingProtection: true, allowedHosts: ALLOWED_HOSTS }
      : {}),
  });
  res.on("close", () => {
    transport.close();
    server.close();
  });
  try {
    await server.connect(transport);
    await transport.handleRequest(req, res, body);
  } catch (e) {
    console.error("MCP 처리 오류:", e);
    if (!res.headersSent && !res.destroyed) {
      sendJson(res, 500, {
        jsonrpc: "2.0",
        error: { code: -32603, message: "내부 오류" },
        id: null,
      });
    }
  }
});

httpServer.listen(PORT, HOST, () => {
  console.log(`simple-wiki MCP 서버(streamable-http) http://${HOST}:${PORT}${MCP_PATH} → 위키 ${BASE.replace(/\/$/, "")}`);
  if (HOST === "0.0.0.0") {
    console.log("주의: 모든 인터페이스(0.0.0.0)에 바인딩됨. TLS/리버스 프록시 뒤에서 운영하세요.");
  }
  console.log(
    FALLBACK_TOKEN
      ? "인증: 요청 Authorization 헤더 우선, 없으면 WIKI_API_TOKEN 사용(단일 사용자용 — 공개 노출 시 비권장)"
      : "인증: 각 요청의 Authorization: Bearer <PAT> 헤더 사용",
  );
  if (ALLOWED_HOSTS?.length) console.log(`DNS 리바인딩 보호 활성: allowedHosts=${ALLOWED_HOSTS.join(", ")}`);
});
