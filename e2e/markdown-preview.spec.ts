import { expect, test } from "@playwright/test";
import { fillMarkdown, login, readMarkdown } from "./helpers";

const previewUrl = "/api/spaces/notice/preview";
const sample = "## 제목\n\n**강조**와 *기울임* 그리고 [링크](https://example.com)\n\n| 항목 | 상태 |\n| --- | --- |\n| 테스트 | 완료 |\n\n~~~js\nconst text = '[[코드]]';\n~~~\n\n마지막 줄";

async function openEditor(page: import("@playwright/test").Page, content = sample) {
  await login(page, "wiki-admin", "admin1234");
  await page.goto("/s/notice/new");
  await fillMarkdown(page, content);
  return page.locator(".live-editor .cm-content");
}

test("클릭한 줄과 표만 원문으로 펼치고 다른 줄은 같은 자리에서 서식으로 표시한다", async ({ page }) => {
  const editor = await openEditor(page);
  await expect(page.getByRole("region", { name: "본문 미리보기" })).toHaveCount(0);
  await expect(page.getByRole("group", { name: "편집 방식" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /^(라이브|원문)$/ })).toHaveCount(0);
  await expect(editor.locator(".live-heading")).toHaveText("제목");
  await expect(editor.locator("strong")).toHaveText("강조");
  await expect(editor.getByRole("cell", { name: "완료" })).toBeVisible();
  await expect(editor.locator("pre code")).toContainText("[[코드]]");
  await editor.locator(".live-heading").click();
  await expect(editor.locator(".live-heading")).toHaveText("## 제목");
  await expect(editor.locator("strong")).toHaveText("강조");
  await editor.getByRole("cell", { name: "완료" }).click();
  await expect(editor.locator("table")).toHaveCount(0);
  await expect(editor).toContainText("| 테스트 | 완료 |");
  await expect(editor.locator(".live-heading")).toHaveText("제목");
  await editor.getByText("마지막 줄", { exact: true }).click();
  await expect(editor.locator("table")).toBeVisible();
  expect(await readMarkdown(page)).toBe(sample);
});

test("실제 입력과 실행 취소, 다시 실행, 새로고침이 원문과 초안을 보존한다", async ({ page }) => {
  const editor = await openEditor(page);
  await editor.getByText("마지막 줄", { exact: true }).click();
  await page.keyboard.press("ControlOrMeta+End");
  await page.keyboard.insertText(" 수정");
  await page.keyboard.press("ControlOrMeta+z");
  await expect(editor).toContainText("마지막 줄");
  await expect(editor).not.toContainText("마지막 줄 수정");
  await page.keyboard.press("ControlOrMeta+Shift+z");
  await expect(editor).toContainText("마지막 줄 수정");
  expect(await readMarkdown(page)).toBe(sample + " 수정");
  await page.reload();
  expect(await readMarkdown(page)).toBe(sample + " 수정");
});

test("라이브 편집에서도 한글 조합 중에는 문법이나 자동완성이 입력을 가로채지 않는다", async ({ page }) => {
  const editor = await openEditor(page, "## ");
  await editor.click();
  await page.keyboard.press("ControlOrMeta+End");
  const ime = await page.context().newCDPSession(page);
  await ime.send("Input.imeSetComposition", { text: "ㅎ", selectionStart: 1, selectionEnd: 1 });
  await ime.send("Input.imeSetComposition", { text: "한글", selectionStart: 2, selectionEnd: 2 });
  await editor.dispatchEvent("keydown", { key: "Enter", isComposing: true, keyCode: 229 });
  await expect(editor).toContainText("한글");
  await expect(page.getByRole("listbox")).toHaveCount(0);
  await ime.send("Input.insertText", { text: "한글" });
  expect(await readMarkdown(page)).toBe("## 한글");
});

test("좁은 화면에서도 표와 긴 링크가 편집 화면을 밀어내지 않는다", async ({ page }) => {
  const editor = await openEditor(page, sample + "\n\n[긴 링크](https://example.com/" + "long-path".repeat(30) + ")");
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(editor.locator("table")).toBeVisible();
    const header = (await editor.locator("th").first().boundingBox())!;
    const cell = (await editor.locator("td").first().boundingBox())!;
    expect(Math.abs(header.x - cell.x)).toBeLessThan(2);
    expect(Math.abs(header.width - cell.width)).toBeLessThan(2);
    expect(Math.abs(cell.y - header.y - header.height)).toBeLessThan(2);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
    await expect(page.getByRole("button", { name: "저장", exact: true })).toBeInViewport();
  }
});

test("터치 화면에서도 표를 누르면 원문을 편집할 수 있다", async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  try {
    const page = await context.newPage();
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    const editor = await openEditor(page);
    await editor.getByRole("cell", { name: "완료" }).tap();
    await expect(editor.locator("table")).toHaveCount(0);
    await expect(editor).toContainText("| 테스트 | 완료 |");
    expect(errors).toEqual([]);
  } finally { await context.close(); }
});

test("미리보기 API는 편집 권한을 확인한 후에만 본문을 렌더링한다", async ({ page, request }) => {
  const data = { content: "[[권한 확인]]" };
  expect((await request.post(previewUrl, { data })).status()).toBe(401);
  await login(page, "bob", "bob1234");
  expect((await page.request.post(previewUrl, { data })).status()).toBe(403);
  expect((await page.request.post("/api/spaces/eng/preview", { data })).status()).toBe(404);
});
