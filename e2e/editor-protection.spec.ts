import { expect, test } from "@playwright/test";
import { login } from "./helpers";

const pages = "/api/spaces/notice/pages";
const newPage = "/s/notice/new";

test.beforeEach(async ({ page }) => {
  await login(page, "wiki-admin", "admin1234");
});

test("제목만 바꾸면 원문을 그대로 저장하고 본문 편집 후에도 코드와 위키링크를 보존한다", async ({ page }) => {
  const title = `editor-source-${Date.now()}`;
  const regex = String.raw`/\[INFO\]/`;
  const source = [
    "원문", "", "~~~~js", `const pattern = ${regex}; // [[example]]`, "~~~~", "",
    `인라인 \`${regex}\` / [[Guide|안내]] / \\[괄호\\]`, "", "마지막 문단", "",
  ].join("\r\n");
  const created = await page.request.post(pages, { data: { title, content: source } });
  expect(created.status()).toBe(201);
  const url = `/s/notice/${title}`;
  await page.goto(`${url}/edit`);
  const editor = page.locator(".milkdown .ProseMirror").first();
  await expect(editor).toContainText("마지막 문단");
  await page.getByRole("textbox", { name: "제목" }).fill(`${title} 수정`);
  await page.getByRole("button", { name: "저장" }).click();
  await expect(page).toHaveURL(url);
  expect((await (await page.request.get(`${pages}/${title}`)).json()).content).toBe(source);

  await page.goto(`${url}/edit`);
  await editor.getByText("마지막 문단").click();
  await page.keyboard.press("End");
  await page.keyboard.insertText(" 수정");
  await page.getByRole("button", { name: "저장" }).click();
  await expect(page).toHaveURL(url);
  const saved = (await (await page.request.get(`${pages}/${title}`)).json()).content;
  expect(saved).toContain(`const pattern = ${regex}; // [[example]]`);
  expect(saved).toContain(`\`${regex}\``);
  expect(saved).toContain("[[Guide|안내]]");
  expect(saved).toContain(String.raw`\[괄호`);
  expect(saved).toContain("마지막 문단 수정");
  await expect(page.getByRole("link", { name: "안내", exact: true })).toBeVisible();
});

test("중복 주소에서도 제목과 본문을 유지하고 새로고침 후 다른 제목으로 저장한다", async ({ page }) => {
  const title = `editor-duplicate-${Date.now()}`;
  const url = `/s/notice/${title}`;
  const create = () => page.request.post(pages, { data: { title, content: "기존 문서" } });
  expect((await Promise.all([create(), create()])).map(r => r.status()).sort()).toEqual([201, 409]);
  await page.goto(newPage);
  const titleBox = page.getByRole("textbox", { name: "제목" });
  const editor = page.locator(".milkdown .ProseMirror").first();
  await titleBox.fill(title.toUpperCase());
  await editor.fill("다른 문서로 저장할 초안");
  await page.getByRole("button", { name: "저장" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "같은 주소" })).toBeVisible();
  await expect(page).toHaveURL(newPage);
  await page.reload();
  await expect(titleBox).toHaveValue(title.toUpperCase());
  await expect(editor).toContainText("다른 문서로 저장할 초안");
  await titleBox.fill(`${title}-new`);
  await page.getByRole("button", { name: "저장" }).click();
  await expect(page).toHaveURL(`${url}-new`);
  expect((await (await page.request.get(`${pages}/${title}`)).json()).content).toBe("기존 문서");
  await expect(page.getByText("다른 문서로 저장할 초안", { exact: true })).toBeVisible();
  await page.goto(newPage);
  await expect(editor).toBeVisible();
  await expect(titleBox).toBeEmpty();
  await expect(editor).not.toContainText("다른 문서로 저장할 초안");
});

test("입력 직후 새로고침과 페이지 이동은 초안을 복원하고 취소는 폐기한다", async ({ page }) => {
  await page.goto(newPage);
  const editor = page.locator(".milkdown .ProseMirror").first();
  const titleBox = page.getByRole("textbox", { name: "제목" });
  await titleBox.fill("작성 중");
  await editor.fill("아직 제출하지 않은 본문");
  await page.reload();
  await expect(editor).toContainText("아직 제출하지 않은 본문");
  await expect(titleBox).toHaveValue("작성 중");
  await page.goto("/s/notice");
  await page.goBack();
  await expect(editor).toContainText("아직 제출하지 않은 본문");
  await page.getByRole("link", { name: "취소" }).click();
  await expect(page).toHaveURL("/s/notice");
  await page.goto(newPage);
  await expect(editor).toBeVisible();
  await expect(titleBox).toBeEmpty();
  await expect(editor).not.toContainText("아직 제출하지 않은 본문");
});

test("초안 복원 후에도 이전 버전 기준으로 충돌을 감지하고 최신 내용을 다시 열 수 있다", async ({ page }) => {
  const title = `editor-conflict-${Date.now()}`;
  expect((await page.request.post(pages, { data: { title, content: "첫 버전" } })).status()).toBe(201);
  await page.goto(`/s/notice/${title}/edit`);
  const editor = page.locator(".milkdown .ProseMirror").first();
  await editor.fill("내 초안");
  expect((await page.request.put(`${pages}/${title}`, { data: { title, content: "상대의 수정" } })).ok()).toBe(true);
  await page.reload();
  await expect(editor).toContainText("내 초안");
  await page.getByRole("button", { name: "저장" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "먼저 수정" })).toBeVisible();
  expect((await (await page.request.get(`${pages}/${title}`)).json()).content).toBe("상대의 수정");
  await page.getByRole("button", { name: "최신 내용 불러오기" }).click();
  await expect(editor).toContainText("상대의 수정");
});

test("새 문서 초안은 대상별로 분리되고 저장 공간이 막혀도 서버에 저장할 수 있다", async ({ page }) => {
  const title = `editor-storage-${Date.now()}`;
  await page.goto(newPage);
  const titleBox = page.getByRole("textbox", { name: "제목" });
  const editor = page.locator(".milkdown .ProseMirror").first();
  await titleBox.fill("다른 초안");
  await editor.fill("남겨 둘 내용");
  await page.goto(`${newPage}?title=${title}`);
  await expect(titleBox).toHaveValue(title);
  await expect(editor).toBeVisible();
  await expect(editor).not.toContainText("남겨 둘 내용");

  await page.evaluate(() => {
    Storage.prototype.setItem = () => { throw new DOMException("가득 참", "QuotaExceededError"); };
  });
  await editor.fill("서버로 저장할 내용");
  await expect(page.getByRole("alert").filter({ hasText: "보관할 수 없습니다" })).toBeVisible();
  await page.getByRole("button", { name: "저장" }).click();
  await expect(page).toHaveURL(`/s/notice/${title}`);
  await expect(page.getByText("서버로 저장할 내용", { exact: true })).toBeVisible();
  await page.goto(newPage);
  await expect(titleBox).toHaveValue("다른 초안");
  await expect(editor).toContainText("남겨 둘 내용");
});

test("저장 요청이 실패해도 다시 열어 마지막 입력을 저장할 수 있다", async ({ page }) => {
  const title = `editor-retry-${Date.now()}`;
  await page.goto(newPage);
  const editor = page.locator(".milkdown .ProseMirror").first();
  const save = page.getByRole("button", { name: "저장" });
  await page.getByRole("textbox", { name: "제목" }).fill(title);
  await editor.fill("실패 후 재시도할 내용");
  await page.route("**/s/notice/new", (route) =>
    route.request().headers()["next-action"] ? route.abort("failed") : route.continue()
  );
  await save.click();
  await expect(page.getByRole("alert").filter({ hasText: "저장에 실패" })).toBeVisible();
  await page.unroute("**/s/notice/new");
  await page.reload();
  await expect(editor).toContainText("실패 후 재시도할 내용");
  await save.click();
  await expect(page).toHaveURL(`/s/notice/${title}`);
  await expect(page.getByText("실패 후 재시도할 내용", { exact: true })).toBeVisible();
});
