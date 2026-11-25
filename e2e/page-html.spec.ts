import { createHash, randomBytes, randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { expect, test } from "@playwright/test";
import { login } from "./helpers";

const db = new PrismaClient();
test.afterAll(() => db.$disconnect());

function temporaryToken(spaceId: string, readOnly: boolean) {
  const raw = "swk_" + randomBytes(32).toString("base64url");
  return {
    headers: { Authorization: `Bearer ${raw}` },
    data: {
      name: "HTML 테스트", spaceId, readOnly, prefix: raw.slice(0, 12),
      tokenHash: createHash("sha256").update(raw).digest("hex"),
    },
  };
}

// A different user reads the editor's HTML through the returned preview URL.
// The same URL must stop revealing the draft when access is revoked or the page is trashed.
test("HTML Viewer는 첫 저장 방법을 안내하고, 저장 후에도 원문 이력과 열람 권한을 보존한다", async ({ page, browser, request }) => {
  test.setTimeout(120_000);
  const key = `preview-${randomUUID()}`;
  const otherKey = `${key}-other`;
  const tokenOwnerId = randomUUID();
  const space = await db.space.create({ data: { key, name: "HTML Viewer 테스트", visibility: "restricted" } });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  try {
    await login(page, "wiki-admin", "admin1234");
    const reader = await context.newPage();
    await login(reader, "bob", "bob1234");
    const user = await db.user.findUniqueOrThrow({ where: { username: "bob" } });
    const grant = await db.spacePermission.create({ data: { spaceId: space.id, subjectType: "user", subjectRef: user.id, role: "viewer" } });
    const title = "한글 HTML 보고서";
    const content = "## 측정\n\n원문 데이터";
    const api = `/api/spaces/${key}/pages`;
    const created = await page.request.post(api, { data: { title, content } });
    expect(created.status()).toBe(201);
    const { slug, url } = await created.json();
    const pageApi = `${api}/${encodeURIComponent(slug)}`;
    const previewApi = `${pageApi}/html`;
    const doc = await (await page.request.get(pageApi)).json();
    const before = await (await page.request.get(`${pageApi}/revisions`)).json();
    await reader.goto(url);
    const viewerLink = reader.getByRole("link", { name: "HTML Viewer", exact: true });
    await expect(viewerLink).toHaveAttribute("href", `${url}/html`);
    await viewerLink.click();
    await expect(reader).toHaveURL(`${url}/html`);
    await expect(reader.getByRole("heading", { name: title, exact: true })).toBeVisible();
    const emptyViewer = reader.getByRole("region", { name: "아직 저장된 HTML이 없습니다" });
    await expect(emptyViewer).toContainText("편집자에게");
    const example = await emptyViewer.getByRole("blockquote").innerText();
    expect(example).toContain(`/s/${key}/${slug}`);
    expect(example).toContain("save_page_html");
    await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: new URL(reader.url()).origin });
    await emptyViewer.getByRole("button", { name: "요청 복사", exact: true }).click();
    await expect(emptyViewer.getByRole("status")).toContainText("복사했습니다");
    expect(await reader.evaluate(() => navigator.clipboard.readText())).toBe(example);
    await expect(reader.locator("iframe")).toHaveCount(0);
    await page.goto(`${url}/html`);
    await expect(page.getByRole("region", { name: "아직 저장된 HTML이 없습니다" }))
      .toContainText("위키 MCP에 연결한 에이전트에게");
    await page.evaluate(() => { Object.defineProperty(navigator, "clipboard", { value: undefined }); });
    await page.getByRole("button", { name: "요청 복사" }).click();
    await expect(page.getByRole("status").filter({ hasText: "직접 복사" })).toBeVisible();
    expect(await page.evaluate(() => window.getSelection()?.toString())).toBe(example);
    const first = { baseVersion: doc.version, html: "<h1>첫 번째 보고서</h1>" };
    const otherSpace = await db.space.create({ data: { key: otherKey, name: "토큰 범위 테스트", visibility: "restricted" } });
    const readOnly = temporaryToken(space.id, true);
    const wrongSpace = temporaryToken(otherSpace.id, false);
    const writable = temporaryToken(space.id, false);
    await db.user.create({
      data: { id: tokenOwnerId, apiTokens: { create: [readOnly.data, wrongSpace.data, writable.data] } },
    });
    await db.spacePermission.create({
      data: { spaceId: space.id, subjectType: "user", subjectRef: tokenOwnerId, role: "editor" },
    });
    expect((await request.put(previewApi, { data: first })).status()).toBe(401);
    expect((await request.put(previewApi, { headers: readOnly.headers, data: first })).status()).toBe(403);
    expect((await request.put(previewApi, { headers: wrongSpace.headers, data: first })).status()).toBe(404);
    expect((await reader.request.put(previewApi, { data: first })).status()).toBe(403);
    const result = await request.put(previewApi, { headers: writable.headers, data: first });
    expect(result.status()).toBe(200);
    const { previewUrl } = await result.json();
    expect(previewUrl).toBe(`${url}/html`);
    await reader.reload();
    await expect(reader).toHaveURL(previewUrl);
    const frame = reader.frameLocator("iframe");
    await expect(frame.getByRole("heading", { name: "첫 번째 보고서" })).toBeVisible();
    await expect(reader.getByRole("button", { name: "요청 복사", exact: true })).toHaveCount(0);
    await expect(reader.locator("iframe")).toHaveAttribute("title", `${title} HTML Viewer`);
    await expect(reader.locator("iframe")).toHaveAttribute("sandbox", "");

    const html = '<!doctype html><html lang="ko"><head><style>.result { color: rgb(23, 81, 65) }</style></head><body><h1 class="result">권한 검색 결과</h1><details><summary>측정값</summary><p>64.6 ms</p></details></body></html>';
    expect((await page.request.put(previewApi, { data: { html, baseVersion: doc.version } })).ok()).toBe(true);
    await reader.reload();
    await expect(frame.getByRole("heading", { name: "권한 검색 결과" })).toHaveCSS("color", "rgb(23, 81, 65)");
    await frame.getByText("측정값", { exact: true }).click();
    await expect(frame.getByText("64.6 ms")).toBeVisible();
    expect(await reader.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
    const after = await (await page.request.get(pageApi)).json();
    expect(after).toMatchObject({ version: doc.version, content, updatedAt: doc.updatedAt });
    expect(await (await page.request.get(`${pageApi}/revisions`)).json()).toEqual(before);

    expect((await page.request.put(pageApi, { data: { title, content: "새 원문", expectedVersion: doc.version } })).ok()).toBe(true);
    const outdated = await page.request.put(previewApi, { data: first });
    expect(outdated.status()).toBe(409);
    expect(await outdated.json()).toMatchObject({ currentVersion: doc.version + 1 });
    await reader.reload();
    await expect(reader.getByRole("status").filter({ hasText: `현재 문서는 v${doc.version + 1}` })).toBeVisible();
    await expect(frame.getByRole("heading", { name: "권한 검색 결과" })).toBeVisible();
    await db.spacePermission.delete({ where: { id: grant.id } });
    await reader.reload();
    await expect(reader.locator("iframe")).toHaveCount(0);
    await expect(reader.getByRole("heading", { name: "페이지를 찾을 수 없습니다" })).toBeVisible();
    expect((await page.request.delete(pageApi)).ok()).toBe(true);
    expect((await page.request.put(previewApi, { data: first })).status()).toBe(404);
    await page.goto(previewUrl);
    await expect(page.getByRole("heading", { name: "페이지를 찾을 수 없습니다" })).toBeVisible();
  } finally {
    await context.close();
    await db.space.deleteMany({ where: { key: { in: [key, otherKey] } } });
    await db.user.deleteMany({ where: { id: tokenOwnerId } });
  }
});
