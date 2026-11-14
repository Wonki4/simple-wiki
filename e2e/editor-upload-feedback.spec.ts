import { expect, test, type Locator } from "@playwright/test";
import { login } from "./helpers";

const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=";

async function sendImage(editor: Locator, kind: "paste" | "drop") {
  await editor.evaluate((el, { kind, png }) => {
    const transfer = new DataTransfer();
    transfer.items.add(new File([Uint8Array.from(atob(png), c => c.charCodeAt(0))], "test.png", { type: "image/png" }));
    const box = el.getBoundingClientRect();
    el.dispatchEvent(kind === "paste"
      ? new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData: transfer })
      : new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: transfer,
          clientX: box.left + 5, clientY: box.top + 5 }));
  }, { kind, png });
}

test("빈 줄에서는 업로드 상태만 표시하고 실패 후 다시 올릴 수 있다", async ({ page }) => {
  await login(page, "wiki-admin", "admin1234");
  await page.goto("/s/notice/new");
  const editor = page.locator(".milkdown .ProseMirror").first();
  await editor.click();
  const hint = editor.locator(".crepe-placeholder");
  const uploadError = page.getByRole("alert").filter({ hasText: "이미지를 올리지 못했습니다" });
  const hintContent = () => hint.evaluate(el => getComputedStyle(el, "::before").content);
  await expect.poll(hintContent).toContain("본문을 입력하세요");

  const imagePath = "/api/attachments/example-preview";
  await page.route(`**${imagePath}`, route => route.fulfill({ contentType: "image/png", body: Buffer.from(png, "base64") }));
  for (const kind of ["paste", "drop"] as const) {
    let release!: () => void;
    const pending = new Promise<void>(resolve => { release = resolve; });
    await page.route("**/api/spaces/notice/attachments", async route => {
      await pending;
      await route.fulfill(kind === "paste" ? { status: 503 } : { json: { url: imagePath } });
    }, { times: 1 });
    const status = editor.getByText(/이미지 올리는 중|Upload in progress/);
    try {
      await sendImage(editor, kind);
      await expect(status).toBeVisible();
      await expect.poll(hintContent).toBe("none");
      await expect(editor.getByRole("status")).toHaveText("이미지 올리는 중…");
      await expect(page.getByRole("button", { name: "저장", exact: true })).toBeDisabled();
      await expect(page.getByRole("button", { name: "원문", exact: true })).toBeDisabled();
    } finally {
      release();
    }
    await expect(status).toHaveCount(0);
    if (kind === "paste") {
      await expect(uploadError).toBeVisible();
      await expect.poll(hintContent).toContain("본문을 입력하세요");
    }
  }
  const image = editor.locator(`img[src="${imagePath}"]`);
  await expect(image).toBeVisible();
  await expect.poll(() => image.evaluate(el => (el as HTMLImageElement).naturalWidth)).toBe(1);
  await expect(uploadError).toHaveCount(0);
  await expect(page.getByRole("button", { name: "저장", exact: true })).toBeEnabled();
});
