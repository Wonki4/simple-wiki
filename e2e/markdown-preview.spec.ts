import { expect, test } from "@playwright/test";
import { login } from "./helpers";

const api = "/api/spaces/notice";
const previewUrl = `${api}/preview`;

test("저장 전 미리보기와 읽기 화면이 같고, 미리보기만으로는 문서 버전이 생기지 않는다", async ({ page }) => {
  await login(page, "wiki-admin", "admin1234");
  const slug = `preview-${Date.now()}`;
  const original = "저장된 첫 문장";
  expect((await page.request.post(`${api}/pages`, { data: { title: slug, content: original } })).status()).toBe(201);
  const uploaded = await page.request.post(`${api}/attachments`, { multipart: { file: {
    name: "preview.png", mimeType: "image/png",
    buffer: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=", "base64"),
  } } });
  expect(uploaded.ok()).toBe(true);
  const { url } = await uploaded.json();
  const markdown = [
    "## 다음 버전", "", "| 항목 | 상태 |", "| --- | --- |", "| 테스트 | 완료 |", "",
    "~~~js", "const ok = true;", "~~~", "", `[[${slug}|원래 문서]]와 [[없는-${slug}]]`, "",
    `![첨부 미리보기](${url})`, "", "<script>alert(1)</script>",
  ].join("\n");
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/s/notice/${slug}/edit`);
  await page.getByRole("button", { name: "원문", exact: true }).click();
  const source = page.getByRole("textbox", { name: "마크다운 원문" });
  const preview = page.getByRole("region", { name: "본문 미리보기" });
  await source.fill(markdown);
  await page.getByRole("button", { name: "미리보기 열기" }).click();
  await expect(preview.getByRole("cell", { name: "완료" })).toBeVisible();
  await expect(preview.locator("pre.shiki")).toContainText("const ok");
  await expect(preview.getByRole("link", { name: "원래 문서" })).toHaveAttribute("href", `/s/notice/${slug}`);
  await expect(preview.locator("a.wiki-link-missing")).toHaveCount(1);
  await expect.poll(() => preview.getByRole("img").evaluate(img => (img as HTMLImageElement).naturalWidth)).toBe(1);
  await expect(preview.locator("script")).toHaveCount(0);
  expect((await preview.boundingBox())!.x).toBeGreaterThan((await source.boundingBox())!.x);
  const stored = await (await page.request.get(`${api}/pages/${slug}`)).json();
  expect(stored).toMatchObject({ version: 1, content: original });

  const newer = markdown.replace("다음 버전", "최종 제목");
  await source.fill(newer);
  await expect(preview.getByRole("heading", { name: /최종 제목/ })).toBeVisible();
  const html = await preview.locator("article").innerHTML();
  await page.setViewportSize({ width: 320, height: 800 });
  const field = (await source.boundingBox())!;
  expect((await preview.boundingBox())!.y).toBeGreaterThanOrEqual(field.y + field.height);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(320);
  await page.getByRole("button", { name: "저장", exact: true }).click();
  const published = page.locator("article.prose-wiki");
  await expect(page).toHaveURL(`/s/notice/${slug}`);
  expect(await published.innerHTML()).toBe(html);
});

test("미리보기 오류에서 재시도하고 비우기·모드 전환 후에도 초안을 계속 편집한다", async ({ page }) => {
  await login(page, "wiki-admin", "admin1234");
  await page.goto("/s/notice/new");
  await page.getByRole("button", { name: "원문", exact: true }).click();
  const input = page.getByRole("textbox", { name: "마크다운 원문" });
  const preview = page.getByRole("region", { name: "본문 미리보기" });
  await page.getByRole("button", { name: "미리보기 열기" }).click();
  await expect(preview).toContainText("미리 볼 본문이 없습니다.");
  await page.route(`**${previewUrl}`, route => route.fulfill({ status: 503 }), { times: 1 });
  await input.fill("**복구할 초안**");
  await expect(preview.getByRole("alert")).toBeVisible();
  await expect(input).toHaveValue("**복구할 초안**");
  await preview.getByRole("button", { name: "다시 시도" }).click();
  await expect(preview.locator("strong")).toHaveText("복구할 초안");

  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  await page.route(`**${previewUrl}`, async route => {
    if (route.request().postDataJSON().content !== "느린 응답") return route.continue();
    await held;
    await route.fulfill({ json: { html: "<p>느린 응답</p>" } });
  });
  const requested = page.waitForRequest(req => req.url().endsWith(previewUrl) && req.postDataJSON().content === "느린 응답");
  await input.fill("느린 응답");
  await requested;
  try {
    await input.fill("## 최신 입력");
    await expect(preview.getByRole("heading", { name: /최신 입력/ })).toBeVisible();
  } finally { release(); }
  await page.unrouteAll({ behavior: "wait" });
  await expect(preview.locator("article")).not.toContainText("느린 응답");
  await page.getByRole("button", { name: "블록", exact: true }).click();
  await expect(preview).toBeHidden();
  await page.getByRole("button", { name: "원문", exact: true }).click();
  await expect(input).toHaveValue("## 최신 입력");
  await input.fill("");
  await expect(preview).toContainText("미리 볼 본문이 없습니다.");
  await expect(preview.locator("article")).toHaveCount(0);
  await page.getByRole("button", { name: "미리보기 닫기" }).click();
  await expect(preview).toBeHidden();
});

test("미리보기 API는 편집 권한을 확인한 후에만 본문을 렌더링한다", async ({ page, request }) => {
  const data = { content: "[[권한 확인]]" };
  expect((await request.post(previewUrl, { data })).status()).toBe(401);
  await login(page, "bob", "bob1234");
  expect((await page.request.post(previewUrl, { data })).status()).toBe(403);
  expect((await page.request.post("/api/spaces/eng/preview", { data })).status()).toBe(404);
});
