import assert from "node:assert/strict";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createWikiMcpServer } from "../dist/tools.js";

test("과거 버전과 다음 커서를 유지하고 빈 결과 처리와 권한 오류를 전달한다", async t => {
  const server = createWikiMcpServer("timeline-test", "http://wiki.internal");
  const client = new Client({ name: "timeline-test", version: "1" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  t.after(async () => { await client.close(); await server.close(); });

  const cursor = "next+/=";
  const page = { space: "eng", slug: "회의록", version: 2 };
  const entry = { kind: "discussion", summary: "롤백 기준 논의", evidence: "오류율 2%를 제안했다.", date: "2026-05-08" };
  const requests = [];
  const fetchMock = t.mock.method(globalThis, "fetch", async (url, init) => {
    assert.equal(init.headers.Authorization, "Bearer timeline-test");
    requests.push({ url: new URL(url), init });
    return Response.json({ ok: true });
  });
  const tools = (await client.listTools()).tools.map(tool => tool.name);
  assert.ok(tools.includes("list_timeline_sources") && tools.includes("save_page_timeline"));
  const range = { space: "eng", from: "2026-05-01", to: "2026-05-31", limit: 2, cursor };
  await client.callTool({ name: "list_timeline_sources", arguments: range });
  assert.equal(requests[0].url.pathname, "/api/spaces/eng/timeline/sources");
  assert.deepEqual(Object.fromEntries(requests[0].url.searchParams), { from: range.from, to: range.to, limit: "2", cursor });

  for (const entries of [[entry], []]) {
    const result = await client.callTool({ name: "save_page_timeline", arguments: { ...page, entries } });
    assert.equal(result.isError, false);
    const { url, init } = requests.at(-1);
    assert.equal(url.pathname, `/api/spaces/eng/pages/${encodeURIComponent(page.slug)}/timeline`);
    assert.equal(init.method, "PUT");
    assert.deepEqual(JSON.parse(init.body), { version: 2, entries });
  }
  fetchMock.mock.mockImplementation(async () => Response.json({ error: "권한이 부족합니다." }, { status: 403 }));
  const denied = await client.callTool({ name: "save_page_timeline", arguments: { ...page, entries: [entry] } });
  assert.equal(denied.isError, true);
  assert.match(denied.content[0].text, /HTTP 403/);
});
