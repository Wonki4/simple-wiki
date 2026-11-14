import { expect, test, type Page } from "@playwright/test";
import { login } from "./helpers";

async function issue(page: Page, name: string, access: string, space?: string) {
  await page.locator('input[name="name"]').fill(name);
  await page.getByLabel("토큰 권한").selectOption(access);
  await page.getByLabel("스페이스 범위").selectOption(space ? { label: space } : "");
  await page.getByRole("button", { name: "토큰 발급" }).click();
  await expect(page.getByText(`새 토큰 “${name}” 발급됨`, { exact: false })).toBeVisible();
  const token = (await page.getByTestId("new-token").innerText()).trim();
  return { Authorization: `Bearer ${token}` };
}

test("관리자 토큰의 읽기·쓰기와 스페이스 범위를 독립적으로 적용한다", async ({ page, request }) => {
  await login(page, "wiki-admin", "admin1234");
  const marker = `scope${Date.now()}`;
  const fileUrls: Record<string, string> = {};
  for (const key of ["eng", "notice"]) {
    const api = `/api/spaces/${key}`;
    expect((await page.request.post(api + "/pages", { data: { title: marker, content: marker } })).status()).toBe(201);
    const attachment = await page.request.post(api + "/attachments", {
      multipart: { file: { name: "test.txt", mimeType: "text/plain", buffer: Buffer.from(key) } },
    });
    expect(attachment.ok()).toBe(true);
    fileUrls[key] = (await attachment.json()).url;
  }
  await page.goto("/settings/tokens");
  const read = await issue(page, marker + "-read", "read", "엔지니어링 (eng)");
  const row = page.getByRole("row").filter({ hasText: marker + "-read" });
  await expect(row).toContainText("읽기 전용");
  await expect(row).toContainText("엔지니어링");
  const readAll = await issue(page, marker + "-search", "read");
  const edit = await issue(page, marker + "-edit", "write", "엔지니어링 (eng)");

  const listed = await (await request.get("/api/spaces", { headers: read })).json();
  expect(listed.spaces.map((s: { key: string; role: string }) => [s.key, s.role])).toEqual([["eng", "viewer"]]);
  const search = "/api/search?q=" + marker;
  expect((await (await request.get(search, { headers: readAll })).json()).total).toBe(2);
  const limited = await (await request.get(search, { headers: read })).json();
  expect(limited.total).toBe(1);
  expect(limited.results[0].spaceKey).toBe("eng");
  expect((await request.get(search + "&space=notice", { headers: read })).status()).toBe(404);

  const pages = "/api/spaces/eng/pages";
  const doc = pages + "/" + marker;
  expect((await request.get(doc, { headers: read })).status()).toBe(200);
  expect((await request.get(doc + "/revisions", { headers: read })).status()).toBe(200);
  expect((await request.get(fileUrls.eng, { headers: read })).status()).toBe(200);
  expect((await request.get(fileUrls.notice, { headers: read })).status()).toBe(404);
  for (const headers of [read, readAll]) {
    expect((await request.post(pages, { headers, data: { title: marker + "-denied" } })).status()).toBe(403);
    expect((await request.put(doc, { headers, data: { title: marker, content: "denied" } })).status()).toBe(403);
    expect((await request.delete(doc, { headers })).status()).toBe(403);
    for (const path of [doc + "/append", doc + "/replace", doc + "/move", doc + "/revert", "/api/spaces/eng/attachments",
      "/api/spaces/eng/trash/fake/restore"]) {
      expect((await request.post(path, { headers, data: {} })).status(), path).toBe(403);
    }
  }
  expect((await request.get("/api/spaces/notice/pages/" + marker, { headers: edit })).status()).toBe(404);
  expect((await request.post("/api/spaces/notice/pages", { headers: edit, data: { title: marker + "-denied" } })).status()).toBe(404);
  expect((await request.put(doc, { headers: edit, data: { title: marker, content: "allowed" } })).status()).toBe(200);
  expect((await (await request.get(doc, { headers: read })).json()).content).toBe("allowed");

  page.once("dialog", dialog => dialog.accept());
  await row.getByRole("button", { name: "삭제" }).click();
  await expect(row).toHaveCount(0);
  expect((await request.get(doc, { headers: read })).status()).toBe(401);
});

test("열람자에게 보이지 않는 스페이스의 발급을 거부하고 쓰기 선택으로 원래 권한을 넘지 않는다", async ({ page, request }) => {
  await login(page, "bob", "bob1234");
  await page.goto("/settings/tokens");
  const selector = page.getByLabel("스페이스 범위");
  await expect(selector.getByRole("option", { name: "엔지니어링 (eng)" })).toHaveCount(0);
  await selector.evaluate((el: HTMLSelectElement) => { el.add(new Option("unavailable", "forged-space")); });
  await selector.selectOption("forged-space");
  await page.locator('input[name="name"]').fill("forged");
  await page.getByRole("button", { name: "토큰 발급" }).click();
  await expect(page.getByText("사용할 수 있는 스페이스를 선택하세요.")).toBeVisible();
  const headers = await issue(page, `viewer-${Date.now()}`, "write", "공지사항 (notice)");
  expect((await request.post("/api/spaces/notice/pages", { headers, data: { title: "denied" } })).status()).toBe(403);
});
