import { expect, test, type Page } from "@playwright/test";
import { fillMarkdown, login, readMarkdown } from "./helpers";

const code = "const text = '<tag> & [[문서]]';\n\n\tconsole.log(text);  \n// " + "긴 코드 ".repeat(30);
const source = `~~~js\n${code}\n~~~\n\n    다른 코드\n    두 번째 줄\n\n마지막`;
const clipboard = (page: Page) => page.evaluate(() => navigator.clipboard.readText());
const testDocuments = new WeakMap<Page, string>();

test.beforeEach(async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: "http://localhost:3000" });
  await login(page, "wiki-admin", "admin1234");
});
test.afterEach(async ({ page }) => {
  const title = testDocuments.get(page);
  if (title) expect((await page.request.delete(`/api/spaces/notice/pages/${title}`)).ok()).toBe(true);
});

async function openLive(page: Page) {
  await page.goto("/s/notice/new");
  await fillMarkdown(page, source);
  return page.locator(".live-editor");
}

test("라이브 복사는 색상 강조 전후 동일하며 편집·초안·실행 취소에 영향을 주지 않는다", async ({ page }) => {
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  await page.route("**/api/spaces/notice/preview", async route => { await held; await route.continue(); });
  try {
    const editor = await openLive(page);
    const button = editor.getByRole("button", { name: "코드 복사" }).first();
    await editor.getByText("마지막", { exact: true }).click();
    await page.keyboard.press("ControlOrMeta+End");
    await page.keyboard.insertText(" 수정");
    await expect(editor.locator("pre.shiki")).toHaveCount(0);
    await button.click();
    await expect(button).toHaveText("복사됨");
    expect(await clipboard(page)).toBe(code);
    await expect(editor.locator("pre")).toHaveCount(2);
    release();
    await expect(editor.locator("pre.shiki")).toHaveCount(1);
    await button.click();
    expect(await clipboard(page)).toBe(code);
    await editor.getByRole("button", { name: "코드 복사" }).last().press("Enter");
    expect(await clipboard(page)).toBe("다른 코드\n두 번째 줄");
    await editor.getByText("마지막 수정", { exact: true }).click();
    await page.keyboard.press("ControlOrMeta+z");
    expect(await readMarkdown(page)).toBe(source);
  } finally { release(); await page.unrouteAll({ behavior: "wait" }); }
});

test("복사 실패를 표시하고 다시 시도할 수 있으며 코드 클릭 편집도 유지된다", async ({ page }) => {
  const editor = await openLive(page);
  await expect(editor.locator("pre.shiki")).toHaveCount(1);
  await page.evaluate(() => {
    const write = navigator.clipboard.writeText.bind(navigator.clipboard);
    let first = true;
    navigator.clipboard.writeText = text => {
      if (first) { first = false; return Promise.reject(new DOMException("denied", "NotAllowedError")); }
      return write(text);
    };
  });
  const button = editor.getByRole("button", { name: "코드 복사" }).first();
  await button.click();
  await expect(button).toHaveText("복사 실패");
  await expect(editor.getByRole("status").first()).toHaveText("코드를 선택해 직접 복사하세요.");
  await button.click();
  await expect(button).toHaveText("복사됨");
  expect(await clipboard(page)).toBe(code);
  await editor.locator("pre").first().click();
  await expect(editor).toContainText("~~~js");
  expect(await readMarkdown(page)).toBe(source);
});

test("읽기와 과거 버전에서도 해당 코드만 복사하며 원문 창을 닫아도 버튼이 유지된다", async ({ page }) => {
  const title = `copy-code-${Date.now()}`;
  const api = "/api/spaces/notice/pages";
  const created = await page.request.post(api, { data: { title, content: source } });
  expect(created.status()).toBe(201);
  testDocuments.set(page, title);
  for (const suffix of ["", "/history/1"]) {
    const width = suffix ? 1280 : 390;
    await page.setViewportSize({ width, height: 900 });
    await page.goto(`/s/notice/${title}${suffix}`);
    const article = page.locator("article");
    const buttons = article.getByRole("button", { name: "코드 복사" });
    await expect(buttons).toHaveCount(2);
    await buttons.first().click();
    await expect(buttons.first()).toHaveText("복사됨");
    expect(await clipboard(page)).toBe(code);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
    await buttons.last().press("Space");
    expect(await clipboard(page)).toBe("다른 코드\n두 번째 줄");
    await page.getByRole("button", { name: "문서 더보기" }).click();
    await page.getByRole("button", { name: "원문 보기" }).click();
    const dialog = page.getByRole("dialog", { name: "마크다운 원문", exact: true });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("button", { name: "코드 복사" })).toHaveCount(0);
    await dialog.getByRole("button", { name: "원문 닫기" }).click();
    await expect(buttons).toHaveCount(2);
    await buttons.first().click();
    expect(await clipboard(page)).toBe(code);
  }
});

test("모바일에서도 긴 코드의 복사 버튼이 보이고 탭해도 원문으로 펼쳐지지 않는다", async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true,
    permissions: ["clipboard-read", "clipboard-write"] });
  try {
    const page = await context.newPage();
    await login(page, "wiki-admin", "admin1234");
    await openLive(page);
    const button = page.getByRole("button", { name: "코드 복사" }).first();
    const pre = page.locator(".live-editor pre.shiki").first();
    await expect(pre).toBeVisible();
    await pre.scrollIntoViewIfNeeded();
    await expect(button).toBeInViewport();
    expect(await pre.evaluate(element => element.scrollWidth > element.clientWidth)).toBe(true);
    await pre.evaluate(element => { element.scrollLeft = element.scrollWidth; });
    await expect(button).toBeInViewport();
    const box = (await button.boundingBox())!;
    expect(box.height).toBeGreaterThanOrEqual(44);
    expect(box.width).toBeGreaterThanOrEqual(44);
    await button.tap();
    await expect(button).toHaveText("복사됨");
    expect(await clipboard(page)).toBe(code);
    await expect(page.locator(".live-editor pre")).toHaveCount(2);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
  } finally { await context.close(); }
});
