import assert from "node:assert/strict";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createWikiMcpServer } from "../dist/tools.js";

const args = { space: "eng", slug: "동시-검색", baseVersion: 7, html: "<h1>결과</h1>" };
const apiBase = "http://wiki.internal:3000";
const previewPath = `/s/eng/${encodeURIComponent(args.slug)}/html`;

async function connect(t, publicUrl) {
  const server = createWikiMcpServer("test-pat", apiBase, publicUrl);
  const client = new Client({ name: "html-preview-test", version: "1" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  t.after(async () => { await client.close(); await server.close(); });
  return client;
}

test("공개 주소로 HTML Viewer 링크를 반환하고 사용자 토큰과 HTML을 내부 API로만 전달한다", async t => {
  const client = await connect(t, "https://wiki.example.com/team/");
  const rest = t.mock.method(globalThis, "fetch", async (url, request) => {
    assert.equal(url, `${apiBase}/api/spaces/eng/pages/${encodeURIComponent(args.slug)}/html`);
    assert.equal(request.method, "PUT");
    assert.equal(request.headers.Authorization, "Bearer test-pat");
    assert.deepEqual(JSON.parse(request.body), { html: args.html, baseVersion: 7 });
    return Response.json({ baseVersion: 7, previewUrl: previewPath });
  });
  const { tools } = await client.listTools();
  const tool = tools.find(tool => tool.name === "save_page_html");
  assert.match(tool.title, /HTML Viewer/);
  assert.deepEqual(tool.inputSchema.required.sort(), ["baseVersion", "html", "slug", "space"]);
  const result = await client.callTool({ name: tool.name, arguments: args });
  assert.equal(result.isError, false);
  assert.deepEqual(JSON.parse(result.content[0].text), { baseVersion: 7, previewUrl: `https://wiki.example.com/team${previewPath}` });
  assert.equal(rest.mock.callCount(), 1);
});

test("별도 공개 주소가 없으면 위키 주소를 사용하고, 다른 주소의 응답은 거부한다", async t => {
  const client = await connect(t);
  const rest = t.mock.method(globalThis, "fetch", async () => Response.json({ baseVersion: 7, previewUrl: previewPath }));
  const result = await client.callTool({ name: "save_page_html", arguments: args });
  assert.equal(JSON.parse(result.content[0].text).previewUrl, apiBase + previewPath);
  rest.mock.mockImplementation(async () => Response.json({ baseVersion: 7, previewUrl: "https://other.example.com" }));
  const unexpected = await client.callTool({ name: "save_page_html", arguments: args });
  assert.equal(unexpected.isError, true);
  assert.doesNotMatch(unexpected.content[0].text, /other\.example/);
});

test("버전 충돌과 쓰기 권한 실패는 성공 링크 없이 에이전트에 전달한다", async t => {
  const client = await connect(t);
  let status = 409;
  const rest = t.mock.method(globalThis, "fetch", async () => {
    const body = status === 409 ? { currentVersion: 8 } : { error: "권한이 부족합니다." };
    return Response.json(body, { status });
  });
  for (status of [409, 403]) {
    const result = await client.callTool({ name: "save_page_html", arguments: args });
    assert.equal(result.isError, true);
    assert.match(result.content[0].text, new RegExp(`HTTP ${status}`));
    if (status === 409) assert.match(result.content[0].text, /"currentVersion": 8/);
    assert.doesNotMatch(result.content[0].text, /previewUrl/);
  }
  assert.equal(rest.mock.callCount(), 2);
});

test("기준 버전·빈 문자열·UTF-8 바이트 제한을 API 호출 전에 검증한다", async t => {
  const client = await connect(t);
  const rest = t.mock.method(globalThis, "fetch", async () => { throw new Error("unexpected request"); });
  for (const change of [{ baseVersion: undefined }, { html: "   " }, { html: "가".repeat(174763) }]) {
    const result = await client.callTool({ name: "save_page_html", arguments: { ...args, ...change } });
    assert.equal(result.isError, true);
  }
  assert.equal(rest.mock.callCount(), 0);
});
