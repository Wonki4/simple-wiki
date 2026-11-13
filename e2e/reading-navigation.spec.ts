import { expect, test } from "@playwright/test";
import { login } from "./helpers";

const pages = "/api/spaces/notice/pages";

test("이름을 여러 번 바꾼 문서의 링크와 백링크가 현재 본문과 과거 버전에서 일치한다", async ({ page }) => {
  await login(page, "wiki-admin", "admin1234");
  const original = `guide-${Date.now()}`;
  const middle = `${original}-middle`;
  const latest = `${original}-latest`;
  const source = `${original}-references`;
  const aliasOnly = `${original}-alias-only`;
  const example = `${original}-examples`;
  const body = `[[${original}|처음]] [[${middle}|중간]] [[${latest}|현재]]`;
  const documents = [
    [original, "대상"],
    [source, body],
    [aliasOnly, `[[${middle}]]`],
    [example, `~~~\n[[${original}]]\n~~~\n\n\`[[${latest}]]\``],
  ];
  for (const [title, content] of documents) {
    expect((await page.request.post(pages, { data: { title, content } })).status()).toBe(201);
  }
  await page.goto(`/s/notice/${source}`);
  await expect(page.locator("article a.wiki-link-missing")).toHaveCount(2);
  for (const title of [middle, latest]) {
    expect((await page.request.put(`${pages}/${original}`, { data: { title, content: "대상" } })).ok()).toBe(true);
  }
  await page.reload();
  await expect(page.locator("article a.wiki-link-missing")).toHaveCount(0);
  expect((await page.request.put(`${pages}/${source}`, { data: { title: source, content: `${body}\n\n최신` } })).ok()).toBe(true);
  for (const path of [`/s/notice/${source}`, `/s/notice/${source}/history/1`]) {
    await page.goto(path);
    for (const label of ["처음", "중간", "현재"]) {
      await expect(page.locator("article").getByRole("link", { name: label, exact: true })).toHaveAttribute("href", `/s/notice/${original}`);
    }
  }
  await page.locator("article").getByRole("link", { name: "현재" }).click();
  await expect(page.getByRole("heading", { name: latest, exact: true })).toBeVisible();
  const backlinks = page.getByRole("complementary").filter({ hasText: "이 페이지를 링크한 문서" });
  await expect(backlinks.getByRole("link")).toHaveText([aliasOnly, source]);
});

test("모바일 목차에서 같은 이름의 소제목을 구분해 공유하고 첨부 원본을 연다", async ({ page, context }) => {
  await login(page, "wiki-admin", "admin1234");
  await page.setViewportSize({ width: 390, height: 844 });
  await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: "http://localhost:3000" });
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=", "base64");
  const uploaded = await page.request.post("/api/spaces/notice/attachments", {
    multipart: { file: { name: "guide.png", mimeType: "image/png", buffer: png } },
  });
  expect(uploaded.ok()).toBe(true);
  const { url } = await uploaded.json();
  const title = `reading-${Date.now()}`;
  expect((await page.request.post(pages, { data: {
    title, content: `## 설치\n\n앞 문단\n\n### 설치\n\n![설치 화면](${url})`,
  } })).status()).toBe(201);
  await page.goto(`/s/notice/${title}`);
  const toc = page.getByRole("navigation", { name: "문서 목차" });
  await toc.locator("summary").click();
  await toc.getByRole("link", { name: "설치", exact: true }).nth(1).click();
  const sectionUrl = page.url();
  expect(decodeURI(sectionUrl)).toMatch(/#section-설치-2$/);
  await page.getByRole("link", { name: "설치 링크 복사" }).nth(1).click();
  await expect(page.getByText("소제목 링크를 복사했습니다.")).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(sectionUrl);
  await page.reload();
  await expect(page.locator(":target")).toHaveAttribute("id", "section-설치-2");
  const popup = page.waitForEvent("popup");
  await page.getByRole("link", { name: "설치 화면 원본 보기" }).click();
  const original = await popup;
  await expect(original).toHaveURL(url);
  await expect(original.locator("img")).toBeVisible();
});
