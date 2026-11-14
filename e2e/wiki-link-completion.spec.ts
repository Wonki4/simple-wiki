import { test, expect, type Page } from "@playwright/test";
import { login } from "./helpers";

async function create(page: Page, space: string, title: string, content = "") {
  const res = await page.request.post(`/api/spaces/${space}/pages`, { data: { title, content } });
  expect(res.status(), await res.text()).toBe(201);
  return (await res.json()).slug as string;
}

test("블록에서 같은 스페이스 후보를 키보드로 골라 실제 문서 링크로 저장한다", async ({ page }) => {
  await login(page, "wiki-admin", "admin1234");
  const prefix = `가이드${Date.now()}`;
  await create(page, "notice", prefix + " A");
  const selected = await create(page, "notice", prefix + " B");
  await create(page, "eng", prefix + " 비공개");
  const title = `link-block-${Date.now()}`;
  await page.goto("/s/notice/new");
  await page.getByRole("textbox", { name: "제목" }).fill(title);
  const editor = page.locator(".milkdown .ProseMirror").first();
  const list = page.getByRole("listbox", { name: "같은 스페이스 문서" });
  await editor.click();
  await page.keyboard.type("[[");
  await expect(list).toBeVisible();
  await page.keyboard.insertText(prefix);
  await expect(list.getByRole("option")).toHaveCount(2);
  await expect(list).not.toContainText("비공개");
  await page.keyboard.press("ArrowDown");
  await expect(list.getByRole("option", { selected: true })).toContainText(prefix + " B");
  await page.keyboard.press("Enter");
  await expect(list).toHaveCount(0);
  await expect(editor).toHaveText(`[[${prefix} B]]`);
  await page.getByRole("button", { name: "저장", exact: true }).click();
  await expect(page.locator("article a.wiki-link")).toHaveAttribute("href", `/s/notice/${encodeURIComponent(selected)}`);
});

test("원문에서 한글 조합과 Esc를 존중하고 마우스로 선택한 링크만 바꾼다", async ({ page }) => {
  await login(page, "wiki-admin", "admin1234");
  const id = Date.now();
  const target = await create(page, "notice", `reference-${id}`);
  const renamed = `변경된 문서 ${id}`;
  const res = await page.request.put(`/api/spaces/notice/pages/${target}`, { data: { title: renamed, content: "" } });
  expect(res.ok()).toBe(true);
  const original = "앞줄  \r\n참조 [[이전|설명]] 뒤\r\n\r\n~~~js\r\ncode\r\n~~~\r\n";
  const slug = await create(page, "notice", `link-source-${id}`, original);
  await page.goto(`/s/notice/${slug}/edit`);
  await page.getByRole("button", { name: "원문", exact: true }).click();
  const source = page.getByRole("textbox", { name: "마크다운 원문" });
  const list = page.getByRole("listbox");
  await source.focus();
  await source.evaluate((el: HTMLTextAreaElement) => {
    const start = el.value.indexOf("이전");
    el.setSelectionRange(start, start + 2);
  });
  const ime = await page.context().newCDPSession(page);
  await ime.send("Input.imeSetComposition", { text: "변경", selectionStart: 2, selectionEnd: 2 });
  await expect(list).toHaveCount(0);
  await source.dispatchEvent("keydown", { key: "Enter", isComposing: true });
  await expect(source).toHaveValue(/\[\[변경\|설명\]\]/);
  await ime.send("Input.insertText", { text: "변경" });
  await expect(list).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(list).toHaveCount(0);
  await page.keyboard.insertText("된 문서 " + id);
  await list.getByRole("option").click();
  const expected = original.replace("이전", target);
  await expect(source).toHaveValue(expected.replace(/\r\n/g, "\n"));
  await page.getByRole("button", { name: "저장", exact: true }).click();
  await expect(page.locator("article a.wiki-link")).toHaveText("설명");
  expect((await (await page.request.get(`/api/spaces/notice/pages/${slug}`)).json()).content).toBe(expected);
});

test("원문의 코드 예시와 수동으로 입력한 새 문서 링크를 방해하지 않는다", async ({ page }) => {
  await login(page, "wiki-admin", "admin1234");
  await page.goto("/s/notice/new");
  await page.getByRole("button", { name: "원문", exact: true }).click();
  const source = page.getByRole("textbox", { name: "마크다운 원문" });
  await source.fill("~~~js\n");
  await page.keyboard.type("[[test");
  await expect(page.getByRole("listbox")).toHaveCount(0);
  await source.fill("");
  await page.keyboard.type("[[no-such-doc-" + Date.now());
  await expect(page.getByText("일치하는 문서가 없습니다.")).toBeVisible();
  await page.keyboard.type("]]");
  await expect(page.getByRole("listbox")).toHaveCount(0);
  await expect(source).toHaveValue(/^\[\[no-such-doc-\d+\]\]$/);
});

test("다른 스페이스의 소제목 자동완성, 실제 앵커, 열람자별 캐시와 백링크", async ({ page, browser }) => {
  await login(page, "wiki-admin", "admin1234");
  const n = Date.now();
  const target = await create(page, "eng", `deploy-${n}`, "## 설치\n\n내용\n\n## 설치\n");
  const title = `runbook-${n}`;
  await page.goto("/s/notice/new");
  await page.getByRole("textbox", { name: "제목" }).fill(title);
  await page.getByRole("button", { name: "원문", exact: true }).click();
  const source = page.getByRole("textbox", { name: "마크다운 원문" });
  await source.fill("[[en");
  await page.getByRole("option", { name: /eng:/ }).click();
  await expect(source).toHaveValue("[[eng:");
  await source.fill(`[[eng:${target}`);
  await expect(page.getByRole("option").filter({ hasText: target })).toBeVisible();
  await source.press("Enter");
  await expect(source).toHaveValue(`[[eng:${target}]]`);
  await source.fill(`## 준비\n\n[[#준`);
  await page.getByRole("option", { name: /준비/ }).click();
  await expect(source).toHaveValue("## 준비\n\n[[#준비]]");
  await source.fill(`## 준비\n\n[[#준비]]\n\n[[eng:${target}#설치`);
  await page.getByRole("option", { name: /설치-2/ }).click();
  const href = `/s/eng/${target}#section-${encodeURIComponent("설치-2")}`;
  const content = await source.inputValue();
  expect(content).toContain(`[[eng:${target}#설치-2]]`);
  await page.getByRole("button", { name: "미리보기 열기" }).click();
  await expect(page.getByRole("region", { name: "본문 미리보기" }).getByRole("link", { name: /eng:/ })).toHaveAttribute("href", href);
  await page.getByRole("button", { name: "저장", exact: true }).click();
  const publicPath = `/s/notice/${title}`;
  await expect(page).toHaveURL(publicPath);
  await page.locator("article").getByRole("link", { name: /eng:/ }).click();
  await expect(page.locator(":target")).toHaveAttribute("id", "section-설치-2");
  await expect(page.locator("aside").getByRole("link", { name: `notice · ${title}` })).toHaveAttribute("href", publicPath);

  const secretSource = await create(page, "eng", `internal-${n}`, `[[notice:${title}#준비]]`);
  await page.goto(publicPath);
  await expect(page.locator("aside").getByRole("link", { name: `eng · ${secretSource}` })).toBeVisible();
  const context = await browser.newContext();
  const viewer = await context.newPage();
  await login(viewer, "bob", "bob1234");
  await viewer.goto(publicPath);
  await expect(viewer.locator("article")).toContainText(`eng:${target}`);
  await expect(viewer.locator('article a[href*="/s/eng/"]')).toHaveCount(0);
  await expect(viewer.locator("main")).not.toContainText(secretSource);
  expect((await viewer.request.get(`/api/spaces/eng/wiki-links?document=${target}`)).status()).toBe(404);
  await viewer.goto(publicPath + "/history/1");
  await expect(viewer.locator('article a[href*="/s/eng/"]')).toHaveCount(0);
  await context.close();
});
