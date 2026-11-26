import assert from "node:assert/strict";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createWikiMcpServer } from "../dist/tools.js";

const base = "http://wiki.internal";
const space = "eng";
const page = { pageId: "original-page-id", slug: "회의록", title: "회의록", version: 8, url: "/s/eng/회의록" };
const source = { space, slug: page.slug, version: page.version, pageId: page.pageId };
const pagesPath = "/api/spaces/eng/pages";
const pagePath = pagesPath + "/" + encodeURIComponent(page.slug);
const quote = "오류율 1%를 롤백 기준으로 채택했다.";
const topics = [{
  key: "배포-롤백", title: "배포와 롤백", expectedVersion: 2,
  changes: [{ key: "오류율", kind: "current", text: "오류율 기준은 1%다.", evidence: quote }],
}];
const written = { version: 8, topics: [{ key: "배포-롤백", version: 3 }] };

async function connect(t, handle) {
  const server = createWikiMcpServer("wiki-topics-pat", base);
  const client = new Client({ name: "wiki-topics-test", version: "1" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  t.after(async () => { await client.close(); await server.close(); });
  const requests = [];
  t.mock.method(globalThis, "fetch", async (url, init) => {
    assert.equal(init.headers.Authorization, "Bearer wiki-topics-pat");
    const request = {
      url: new URL(url), method: init.method ?? "GET", body: init.body ? JSON.parse(init.body) : undefined,
    };
    requests.push(request);
    return handle(request);
  });
  return { client, requests };
}

test("다섯 원문 저장 도구가 실제로 저장된 버전에 관련 주제만 이어서 반영한다", async t => {
  const { client, requests } = await connect(t, req => Response.json(req.url.pathname.endsWith("/llm-wiki") ? written : page));
  const edits = [
    ["create_page", "POST", "", { title: page.title, content: quote, parent: "meetings" }],
    ["update_page", "PUT", "", { title: page.title, content: quote, expectedVersion: 7 }],
    ["append_to_page", "POST", "/append", { content: quote, expectedVersion: 7 }],
    ["replace_in_page", "POST", "/replace", { old_string: "2%", new_string: "1%", expectedVersion: 7 }],
    ["revert_page", "POST", "/revert", { version: 3, expectedVersion: 7 }],
  ];
  for (const [name, method, suffix, body] of edits) {
    requests.length = 0;
    const address = name === "create_page" ? { space } : { space, slug: page.slug };
    const result = await client.callTool({ name, arguments: { ...address, ...body, wikiTopics: topics } });
    assert.equal(result.isError, false, name);
    assert.deepEqual(JSON.parse(result.content[0].text), { ...page, llmWiki: { status: "complete", result: written } });
    assert.equal(requests.length, 2);
    assert.equal(requests[0].url.pathname, name === "create_page" ? pagesPath : pagePath + suffix);
    assert.equal(requests[0].method, method);
    assert.deepEqual(requests[0].body, body);
    assert.equal(requests[1].url.pathname, pagePath + "/llm-wiki");
    assert.equal(requests[1].method, "PUT");
    assert.deepEqual(requests[1].body, { version: 8, topics, pageId: page.pageId });
  }
});

test("주제를 생략한 기존 호출은 후속 도구와 원문을 안내하고 빈 변경도 처리한다", async t => {
  const { client, requests } = await connect(t, req => Response.json(req.url.pathname === pagesPath ? page : { version: 8, topics: [] }));
  const args = { space, title: page.title };
  const result = await client.callTool({ name: "create_page", arguments: args });
  const { llmWiki, ...saved } = JSON.parse(result.content[0].text);
  assert.equal(result.isError, false);
  assert.deepEqual(saved, page);
  assert.equal(llmWiki.status, "pending");
  assert.deepEqual(llmWiki.source, source);
  assert.equal(llmWiki.nextTool, "save_page_wiki_topics");
  assert.equal(requests.length, 1);
  const followup = await client.callTool({ name: llmWiki.nextTool, arguments: { ...llmWiki.source, topics: [] } });
  assert.equal(followup.isError, false);
  assert.equal(requests[1].url.pathname, pagePath + "/llm-wiki");
  assert.deepEqual(requests[1].body, { version: 8, topics: [], pageId: page.pageId });
  const noop = await client.callTool({ name: "create_page", arguments: { ...args, wikiTopics: [] } });
  assert.equal(JSON.parse(noop.content[0].text).llmWiki.status, "complete");
  assert.deepEqual(requests[3].body, { version: 8, topics: [], pageId: page.pageId });
});

test("원문 저장 실패 시 멈추고 주제만 실패하면 원문을 다시 쓰지 않고 재시도할 수 있다", async t => {
  let failPage = true;
  let topicStatus = 409;
  const { client, requests } = await connect(t, req => {
    if (req.url.pathname === pagesPath) return Response.json(failPage ? { error: "conflict" } : page, { status: failPage ? 409 : 201 });
    if (topicStatus === 0) throw new Error("offline");
    return Response.json(topicStatus === 200 ? written : { error: "conflict" }, { status: topicStatus });
  });
  const args = { space, title: page.title, wikiTopics: topics };
  const failed = await client.callTool({ name: "create_page", arguments: args });
  assert.equal(failed.isError, true);
  assert.equal(requests.length, 1);
  failPage = false;
  for (const status of [409, 0]) {
    topicStatus = status;
    const partial = await client.callTool({ name: "create_page", arguments: args });
    const saved = JSON.parse(partial.content[0].text);
    assert.equal(partial.isError, false);
    assert.equal(saved.version, page.version);
    assert.equal(saved.llmWiki.status, "pending");
    assert.equal(saved.llmWiki.httpStatus, status || undefined);
    assert.ok(saved.llmWiki.error);
    topicStatus = 200;
    const count = requests.length;
    const retry = await client.callTool({ name: saved.llmWiki.nextTool, arguments: { ...saved.llmWiki.source, topics } });
    assert.equal(retry.isError, false);
    assert.equal(requests.length, count + 1);
    assert.equal(requests.at(-1).url.pathname, pagePath + "/llm-wiki");
  }
});

test("주제 검색·상세·원문 버전 조회가 올바른 읽기 경로를 사용한다", async t => {
  const { client, requests } = await connect(t, () => Response.json({}));
  const tools = (await client.listTools()).tools.map(tool => tool.name);
  for (const name of ["list_wiki_topics", "get_wiki_topic", "save_page_wiki_topics"]) assert.ok(tools.includes(name));
  await client.callTool({ name: "list_wiki_topics", arguments: { space, query: "배포 & 롤백", sourceSlug: page.slug, offset: 30, limit: 10 } });
  await client.callTool({ name: "get_wiki_topic", arguments: { space, key: topics[0].key } });
  await client.callTool({ name: "get_page", arguments: source });
  assert.equal(requests[0].url.pathname, "/api/spaces/eng/llm-wiki");
  assert.deepEqual(Object.fromEntries(requests[0].url.searchParams), { q: "배포 & 롤백", sourceSlug: page.slug, offset: "30", limit: "10" });
  assert.equal(requests[1].url.pathname, "/api/spaces/eng/llm-wiki/" + encodeURIComponent(topics[0].key));
  assert.equal(requests[2].url.pathname, pagePath);
  assert.equal(requests[2].url.searchParams.get("version"), "8");
  assert.ok(requests.every(req => req.method === "GET"));
});

test("같은 주소가 다른 문서에 재사용되면 원래의 pageId로 후속 요청해 충돌을 전달한다", async t => {
  const { client, requests } = await connect(t, req => {
    if (req.url.pathname === pagesPath) return Response.json(page);
    if (req.body.pageId !== "replacement-id") return Response.json({ error: "원문이 바뀌었습니다." }, { status: 409 });
    return Response.json(written);
  });
  const saved = await client.callTool({ name: "create_page", arguments: { space, title: page.title, wikiTopics: topics } });
  const pending = JSON.parse(saved.content[0].text).llmWiki;
  assert.equal(pending.status, "pending");
  assert.equal(pending.httpStatus, 409);
  const retried = await client.callTool({ name: pending.nextTool, arguments: { ...pending.source, topics } });
  assert.equal(retried.isError, true);
  assert.match(retried.content[0].text, /HTTP 409/);
  assert.deepEqual(requests.slice(1).map(req => req.body.pageId), [page.pageId, page.pageId]);
});
