// MCP 서버를 spawn해 도구를 실제 호출하는 스모크 테스트.
// 사용: WIKI_API_TOKEN=... node smoke-test.mjs
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const token = process.env.WIKI_API_TOKEN;
if (!token) throw new Error("WIKI_API_TOKEN 필요");

const transport = new StdioClientTransport({
  command: "node",
  args: [path.join(__dirname, "dist/index.js")],
  env: { ...process.env, WIKI_API_TOKEN: token, WIKI_BASE_URL: "http://localhost:3000" },
});
const client = new Client({ name: "smoke", version: "1.0.0" });
await client.connect(transport);

const call = async (name, args = {}) => {
  const r = await client.callTool({ name, arguments: args });
  return { isError: r.isError, text: r.content?.[0]?.text ?? "" };
};

const tools = await client.listTools();
console.log("TOOLS:", tools.tools.map((t) => t.name).join(", "));

const spaces = await call("list_spaces");
console.log("\n[list_spaces] isError=%s\n%s", spaces.isError, spaces.text.slice(0, 240));

const pages = await call("list_pages", { space: "eng" });
console.log("\n[list_pages eng] isError=%s\n%s", pages.isError, pages.text.slice(0, 200));

const created = await call("create_page", {
  space: "eng",
  title: "MCP 테스트 문서",
  content: "# MCP 테스트\n\nMCP 서버로 만든 문서입니다. [[배포 가이드]] 참고.",
});
console.log("\n[create_page] isError=%s\n%s", created.isError, created.text);
const slug = JSON.parse(created.text).slug;

const got = await call("get_page", { space: "eng", slug });
console.log("\n[get_page %s] isError=%s\n%s", slug, got.isError, got.text.slice(0, 180));

const updated = await call("update_page", {
  space: "eng",
  slug,
  title: "MCP 테스트 문서",
  content: "# MCP 테스트\n\nMCP 서버로 **수정**했습니다.",
});
console.log("\n[update_page] isError=%s\n%s", updated.isError, updated.text);

const notFound = await call("get_page", { space: "eng", slug: "없는-문서-xyz" });
console.log("\n[get_page 없는문서] isError=%s (true 기대)\n%s", notFound.isError, notFound.text.slice(0, 120));

const denied = await call("create_page", { space: "notice", title: "몰래", content: "x" });
console.log("\n[create_page notice(viewer)] isError=%s (true/403 기대)\n%s", denied.isError, denied.text.slice(0, 120));

// 정리: 방금 만든 테스트 문서 삭제
const del = await call("delete_page", { space: "eng", slug });
console.log("\n[delete_page] isError=%s\n%s", del.isError, del.text);

await client.close();
console.log("\n=== smoke test done ===");
