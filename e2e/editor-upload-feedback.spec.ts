import { expect, test, type Locator } from "@playwright/test";
import { login } from "./helpers";

const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=";
const endpoint = "**/api/spaces/notice/attachments";

async function sendImages(editor: Locator, kind: "paste" | "drop", names: string[]) {
  await editor.evaluate((el, { kind, names, png }) => {
    const transfer = new DataTransfer();
    for (const name of names) {
      transfer.items.add(new File([Uint8Array.from(atob(png), c => c.charCodeAt(0))], name, { type: "image/png" }));
    }
    const box = el.getBoundingClientRect();
    el.dispatchEvent(kind === "paste"
      ? new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData: transfer })
      : new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: transfer,
          clientX: box.left + 5, clientY: box.top + 5 }));
  }, { kind, names, png });
}

for (const kind of ["paste", "drop"] as const) {
  test(`${kind}로 올린 이미지 중 실패한 한 장만 다시 올린다`, async ({ page }) => {
    await login(page, "wiki-admin", "admin1234");
    await page.goto("/s/notice/new");
    const editor = page.locator(".milkdown .ProseMirror").first();
    await editor.click();
    const hintContent = () => editor.locator(".crepe-placeholder").first().evaluate(el => getComputedStyle(el, "::before").content);
    await expect.poll(hintContent).toContain("본문을 입력하세요");

    let release!: () => void;
    const pending = new Promise<void>(resolve => { release = resolve; });
    const requests: string[] = [];
    await page.route(endpoint, async route => {
      const filename = /filename="([^"]+)"/.exec(route.request().postDataBuffer()!.toString("latin1"))![1];
      requests.push(filename);
      await pending;
      if (filename === "retry.png" && requests.filter(name => name === filename).length === 1) {
        await route.fulfill({ status: 503 });
      } else {
        await route.continue();
      }
    });
    try {
      await sendImages(editor, kind, ["ok.png", "retry.png"]);
      await expect(editor.getByRole("status")).toHaveText("이미지 올리는 중…");
      await expect.poll(hintContent).toBe("none");
      await expect(page.getByRole("button", { name: "저장", exact: true })).toBeDisabled();
      await expect(page.getByRole("button", { name: "원문", exact: true })).toBeDisabled();
    } finally {
      release();
    }
    const failures = page.getByRole("list", { name: "업로드 실패 목록" });
    await expect(failures.getByRole("alert")).toContainText("retry.png");
    await expect(failures.getByRole("alert")).toContainText("503");
    const images = editor.locator('img[src^="/api/attachments/"]');
    await expect(images).toHaveCount(1);
    await failures.getByRole("button", { name: "다시 시도" }).click();
    await expect(failures).toHaveCount(0);
    await expect(images).toHaveCount(2);
    await expect.poll(() => images.evaluateAll(els => els.every(el => (el as HTMLImageElement).naturalWidth === 1))).toBe(true);
    expect(requests.sort()).toEqual(["ok.png", "retry.png", "retry.png"]);
  });
}

test("여러 첨부 중 실패한 파일만 재시도하고 원문과 성공한 링크를 그대로 저장한다", async ({ page }) => {
  await login(page, "wiki-admin", "admin1234");
  await page.goto("/s/notice/new");
  const title = `upload-retry-${Date.now()}`;
  await page.getByRole("textbox", { name: "제목" }).fill(title);
  await page.getByRole("button", { name: "원문", exact: true }).click();
  const source = page.getByRole("textbox", { name: "마크다운 원문" });
  await source.fill("남겨야 할 본문\n");
  const requests: string[] = [];
  await page.route(endpoint, async route => {
    const name = /filename="([^"]+)"/.exec(route.request().postDataBuffer()!.toString())![1];
    requests.push(name);
    if (name === "blocked.txt") return route.fulfill({ status: 403 });
    const attempt = requests.filter(n => n === "retry.txt").length;
    if (name === "retry.txt" && attempt === 1) return route.abort();
    if (name === "retry.txt" && attempt === 2) return route.fulfill({ status: 503 });
    return route.continue();
  });
  const files = ["first.txt", "retry.txt", "blocked.txt", "last.txt"];
  await page.locator('input[type="file"][multiple]').setInputFiles(files.map(name => ({
    name, mimeType: "text/plain", buffer: Buffer.from(name),
  })));
  const list = page.getByRole("list", { name: "업로드 실패 목록" });
  const retry = list.getByRole("listitem").filter({ hasText: "retry.txt" });
  const blocked = list.getByRole("listitem").filter({ hasText: "blocked.txt" });
  await expect(retry).toContainText("네트워크");
  await expect(blocked).toContainText("권한");
  await expect(source).toHaveValue(/last\.txt/);
  const previous = await source.inputValue();
  await retry.getByRole("button", { name: "다시 시도" }).click();
  await expect(retry).toContainText("503");
  await expect(source).toHaveValue(previous);
  await retry.getByRole("button", { name: "다시 시도" }).click();
  await expect(retry).toHaveCount(0);
  await expect(source).toHaveValue(/retry\.txt/);
  expect(await source.inputValue()).toContain(previous);
  await blocked.getByRole("button", { name: "목록에서 제거" }).click();
  await expect(list).toHaveCount(0);
  expect(requests).toEqual([...files, "retry.txt", "retry.txt"]);
  await page.getByRole("button", { name: "저장", exact: true }).click();
  await expect(page).toHaveURL(`/s/notice/${title}`);
  const article = page.locator("article.prose-wiki");
  await expect(article).toContainText("남겨야 할 본문");
  for (const name of ["first.txt", "last.txt", "retry.txt"]) {
    await expect(article.getByRole("link", { name, exact: true })).toHaveCount(1);
  }
  await expect(article).not.toContainText("blocked.txt");
});

test("이미지 블록에서 고른 파일은 다시 선택하지 않아도 원래 블록을 채운다", async ({ page }) => {
  await login(page, "wiki-admin", "admin1234");
  await page.goto("/s/notice/new");
  await page.getByRole("button", { name: "원문", exact: true }).click();
  await page.getByRole("textbox", { name: "마크다운 원문" }).fill("앞 문단\n\n![]()\n\n뒤 문단");
  await page.getByRole("button", { name: "블록", exact: true }).click();
  const editor = page.locator(".milkdown .ProseMirror").first();
  const picker = editor.locator('input[type="file"][accept="image/*"]');
  await page.route(endpoint, route => route.fulfill({ status: 401 }), { times: 1 });
  await picker.setInputFiles({ name: "picker.png", mimeType: "image/png", buffer: Buffer.from(png, "base64") });
  const failed = page.getByRole("listitem").filter({ hasText: "picker.png" });
  await expect(failed).toContainText("로그인");
  await failed.getByRole("button", { name: "다시 시도" }).click();
  const image = editor.locator('img[src^="/api/attachments/"]');
  await expect(image).toHaveCount(1);
  await expect(picker).toHaveCount(0);
  await page.getByRole("button", { name: "원문", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "마크다운 원문" })).toHaveValue(/앞 문단[\s\S]*!\[[^\]]*\]\(\/api\/attachments\/[^)]+\)[\s\S]*뒤 문단/);
});
