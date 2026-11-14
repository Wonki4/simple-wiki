import { expect, test } from "@playwright/test";
import { login } from "./helpers";

const api = "/api/spaces/notice/pages";
const original = [
  "# MCP 문서  ", "", "|키  | 값|", "|:---|--:|", "|a |  1|", "",
  "~~~~js", "const escaped = /\\[INFO\\]/;", "~~~~", "",
  "[[안내|가이드]]", "바꿀 문장", "", "<em>원문 태그</em>", "",
].join("\r\n").replace("가이드]]\r\n", "가이드]]\n");
const display = (raw: string) => raw.replace(/\r\n?/g, "\n");

test("원문에서 한 줄 수정 후 새로고침·모드 전환·저장을 해도 다른 바이트는 보존된다", async ({ page }) => {
  await login(page, "wiki-admin", "admin1234");
  const title = `raw-edit-${Date.now()}`;
  expect((await page.request.post(api, { data: { title, content: original } })).status()).toBe(201);
  const url = `/s/notice/${title}`;
  await page.goto(`${url}/edit`);
  const rawButton = page.getByRole("button", { name: "원문", exact: true });
  const blocks = page.getByRole("button", { name: "블록", exact: true });
  const input = page.getByRole("textbox", { name: "마크다운 원문" });
  await rawButton.click();
  await expect(input).toHaveValue(display(original));
  const updated = original.replace("바꿀 문장", "고친 문장");
  await input.fill(display(updated));
  await blocks.click();
  await expect(page.locator(".milkdown .ProseMirror").first()).toContainText("고친 문장");
  await rawButton.click();
  await page.reload();
  await expect(input).toHaveValue(display(updated));
  await blocks.click();
  const blockEditor = page.locator(".milkdown .ProseMirror").first();
  await expect(blockEditor).toContainText("고친 문장");
  await rawButton.click();
  await expect(input).toHaveValue(display(updated));
  await blocks.click();
  await page.getByRole("button", { name: "저장" }).click();
  await expect(page).toHaveURL(url);
  expect((await (await page.request.get(`${api}/${title}`)).json()).content).toBe(updated);
});

test("읽기 권한으로 현재와 과거 버전의 원문을 구분해 보고 복사한다", async ({ page, browser, baseURL }) => {
  await login(page, "wiki-admin", "admin1234");
  const title = `raw-read-${Date.now()}`;
  const latest = "# 최신\n\n새 본문\n";
  expect((await page.request.post(api, { data: { title, content: original } })).status()).toBe(201);
  expect((await page.request.put(`${api}/${title}`, { data: { title, content: latest } })).ok()).toBe(true);
  const reader = await browser.newContext({ viewport: { width: 320, height: 800 } });
  await reader.grantPermissions(["clipboard-read", "clipboard-write"], { origin: baseURL });
  const view = await reader.newPage();
  await login(view, "bob", "bob1234");
  for (const [suffix, source] of [["", latest], ["/history/1", original]]) {
    await view.goto(`/s/notice/${title}${suffix}`);
    await expect(view.getByRole("link", { name: "편집", exact: true })).toHaveCount(0);
    await view.getByRole("button", { name: "원문", exact: true }).click();
    const pre = view.getByLabel("마크다운 원문");
    expect(await pre.textContent()).toBe(source);
    await expect(pre.locator("em")).toHaveCount(0);
    await view.getByRole("button", { name: "원문 복사" }).click();
    await expect(view.getByRole("status").filter({ hasText: "원문을 복사했습니다" })).toBeVisible();
    expect(display(await view.evaluate(() => navigator.clipboard.readText()))).toBe(display(source));
    expect(await view.evaluate(() => document.documentElement.scrollWidth)).toBe(320);
    await view.getByRole("button", { name: "본문", exact: true }).click();
    await expect(view.locator("article.prose-wiki")).toBeVisible();
  }
  await reader.close();
});

test("새 문서에서 블록 입력 직후 원문으로 전환해 선택 영역에 파일을 첨부하고 저장한다", async ({ page }) => {
  await login(page, "wiki-admin", "admin1234");
  const title = `raw-attach-${Date.now()}`;
  await page.goto("/s/notice/new");
  await page.getByRole("textbox", { name: "제목" }).fill(title);
  await page.locator(".milkdown .ProseMirror").first().fill("앞 첨부 뒤");
  await page.getByRole("button", { name: "원문", exact: true }).click();
  const input = page.getByRole("textbox", { name: "마크다운 원문" });
  await expect(input).toHaveValue(/앞 첨부 뒤/);
  await input.evaluate((el: HTMLTextAreaElement) => el.setSelectionRange(2, 4));
  await page.locator('input[type="file"]').setInputFiles({
    name: "note.txt", mimeType: "text/plain", buffer: Buffer.from("source mode"),
  });
  await expect(input).toHaveValue(/앞 \[note\.txt\]\(\/api\/attachments\/[^)]+\) 뒤/);
  const body = await input.inputValue();
  await page.getByRole("button", { name: "저장" }).click();
  await expect(page).toHaveURL(`/s/notice/${title}`);
  expect((await (await page.request.get(`${api}/${title}`)).json()).content).toBe(body);
  await expect(page.getByRole("link", { name: "note.txt" })).toBeVisible();
});
