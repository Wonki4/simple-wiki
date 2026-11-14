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
