import { expect, test } from "@playwright/test";
import { fillMarkdown, login, readMarkdown, selectMarkdownRange } from "./helpers";

const api = "/api/spaces/notice/pages";
const original = [
  "# MCP 문서  ", "", "|키  | 값|", "|:---|--:|", "|a |  1|", "",
  "~~~~js", "const escaped = /\\[INFO\\]/;", "~~~~", "",
  "[[안내|가이드]]", "바꿀 문장", "", "<em>원문 태그</em>", "",
].join("\r\n").replace("가이드]]\r\n", "가이드]]\n");
const display = (raw: string) => raw.replace(/\r\n?/g, "\n");

test("라이브에서 한 줄 수정 후 새로고침·저장을 해도 다른 원문 바이트는 보존된다", async ({ page }) => {
  await login(page, "wiki-admin", "admin1234");
  const title = `raw-edit-${Date.now()}`;
  expect((await page.request.post(api, { data: { title, content: original } })).status()).toBe(201);
  const url = `/s/notice/${title}`;
  await page.goto(`${url}/edit`);
  expect(await readMarkdown(page)).toBe(display(original));
  const updated = original.replace("바꿀 문장", "고친 문장");
  await fillMarkdown(page, display(updated));
  await page.reload();
  expect(await readMarkdown(page)).toBe(display(updated));
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
    await expect(view.getByRole("group", { name: "보기 방식" })).toHaveCount(0);
    await expect(view.getByRole("button", { name: "원문 보기", exact: true })).toBeHidden();
    const more = view.getByRole("button", { name: "문서 더보기" });
    await more.click();
    await view.getByRole("button", { name: "원문 보기", exact: true }).click();
    const dialog = view.getByRole("dialog", { name: "마크다운 원문", exact: true });
    await expect(dialog).toBeVisible();
    const pre = dialog.getByLabel("마크다운 원문");
    expect(await pre.textContent()).toBe(source);
    await expect(pre.locator("em")).toHaveCount(0);
    await view.getByRole("button", { name: "원문 복사" }).click();
    await expect(view.getByRole("status").filter({ hasText: "원문을 복사했습니다" })).toBeVisible();
    expect(display(await view.evaluate(() => navigator.clipboard.readText()))).toBe(display(source));
    if (!suffix) {
      await view.evaluate(() => {
        const write = navigator.clipboard.writeText.bind(navigator.clipboard);
        navigator.clipboard.writeText = () => {
          navigator.clipboard.writeText = write;
          return Promise.reject(new DOMException("denied", "NotAllowedError"));
        };
      });
      await dialog.getByRole("button", { name: "원문 복사" }).click();
      await expect(dialog.getByRole("status")).toHaveText("원문을 선택해 직접 복사하세요.");
      await dialog.getByRole("button", { name: "원문 복사" }).click();
      await expect(dialog.getByRole("status")).toHaveText("원문을 복사했습니다.");
    }
    expect(await view.evaluate(() => document.documentElement.scrollWidth)).toBe(320);
    const box = (await dialog.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(320);
    if (suffix) await dialog.getByRole("button", { name: "원문 닫기" }).click();
    else await view.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(more).toBeFocused();
    await expect(view.locator("article.prose-wiki")).toBeVisible();
  }
  await reader.close();
});

test("라이브 편집에서 선택 영역에 파일을 첨부하고 원문 그대로 저장한다", async ({ page }) => {
  await login(page, "wiki-admin", "admin1234");
  const title = `raw-attach-${Date.now()}`;
  await page.goto("/s/notice/new");
  await page.getByRole("textbox", { name: "제목" }).fill(title);
  await fillMarkdown(page, "앞 첨부 뒤", false);
  await selectMarkdownRange(page, 2, 4);
  await page.locator('input[type="file"]').setInputFiles({
    name: "note.txt", mimeType: "text/plain", buffer: Buffer.from("live attachment"),
  });
  await expect(page.getByRole("textbox", { name: "본문", exact: true })).toContainText("note.txt");
  const body = await readMarkdown(page);
  expect(body).toMatch(/앞 \[note\.txt\]\(\/api\/attachments\/[^)]+\) 뒤/);
  await page.getByRole("button", { name: "저장" }).click();
  await expect(page).toHaveURL(`/s/notice/${title}`);
  expect((await (await page.request.get(`${api}/${title}`)).json()).content).toBe(body);
  await expect(page.getByRole("link", { name: "note.txt" })).toBeVisible();
});
