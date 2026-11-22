import type { Page } from "@playwright/test";

export async function login(page: Page, username: string, password: string) {
  await page.goto("/");
  await page.getByRole("button", { name: "로그인" }).click();
  await page.waitForURL(/localhost:8080/);
  await page.fill("#username", username);
  await page.fill("#password", password);
  await page.click("#kc-login");
  await page.waitForURL("http://localhost:3000/**");
}

export async function fillMarkdown(page: Page, content: string, blur = true) {
  const editor = page.getByRole("textbox", { name: "본문", exact: true });
  await editor.press("ControlOrMeta+a");
  if (content) await page.keyboard.insertText(content);
  else await page.keyboard.press("Backspace");
  if (blur) await page.getByRole("textbox", { name: "제목", exact: true }).click();
  return editor;
}

// Exercise the editor's copy behavior, which must expose the source even when
// inactive lines render as widgets. No private CodeMirror state is inspected.
export async function readMarkdown(page: Page) {
  const editor = page.getByRole("textbox", { name: "본문", exact: true });
  await editor.press("ControlOrMeta+a");
  const text = await editor.evaluate(element => {
    const data = new DataTransfer();
    element.dispatchEvent(new ClipboardEvent("copy", { bubbles: true, cancelable: true, clipboardData: data }));
    return data.getData("text/plain");
  });
  await page.keyboard.press("ArrowRight");
  await page.getByRole("textbox", { name: "제목", exact: true }).click();
  return text;
}

export async function selectMarkdownRange(page: Page, from: number, to: number) {
  const editor = page.getByRole("textbox", { name: "본문", exact: true });
  await editor.press("ControlOrMeta+Home");
  for (let i = 0; i < from; i++) await page.keyboard.press("ArrowRight");
  for (let i = from; i < to; i++) await page.keyboard.press("Shift+ArrowRight");
}
