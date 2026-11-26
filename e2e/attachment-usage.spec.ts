import { expect, test, type Page } from "@playwright/test";
import { login } from "./helpers";

async function upload(page: Page, space: string, name: string) {
  const res = await page.request.post(`/api/spaces/${space}/attachments`, {
    multipart: { file: { name, mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.7") } },
  });
  expect(res.ok()).toBe(true);
  return (await res.json()).url as string;
}

async function create(page: Page, space: string, title: string, content: string) {
  const res = await page.request.post(`/api/spaces/${space}/pages`, { data: { title, content } });
  expect(res.status()).toBe(201);
  return (await res.json()).slug as string;
}

test("열람자가 파일을 찾아 사용 문서로 이동하고 본문 수정·삭제·복원 결과를 확인한다", async ({ page, browser }) => {
  await login(page, "wiki-admin", "admin1234");
  const prefix = `usage-${Date.now()}`;
  const name = `${prefix}-notes.pdf`;
  const url = await upload(page, "notice", name);
  const unusedName = `${prefix}-unused.pdf`;
  await upload(page, "notice", unusedName);
  const first = await create(page, "notice", `${prefix}-a`, `![이미지](${url})\n\n[자료](${url})`);
  const second = await create(page, "notice", `${prefix}-b`, `[참고][첨부]\n\n[첨부]: ${url}`);
  const listing = "/s/notice/-/attachments";
  const api = "/api/spaces/notice";

  const reader = await browser.newContext({ viewport: { width: 360, height: 800 } });
  const view = await reader.newPage();
  await login(view, "bob", "bob1234");
  await view.goto("/s/notice");
  const filesTab = view.getByRole("navigation", { name: "스페이스 보기" }).getByRole("link", { name: "첨부파일", exact: true });
  await filesTab.click();
  await expect(filesTab).toHaveAttribute("aria-current", "page");
  const row = view.locator(".attachment-list > li").filter({ has: view.getByRole("heading", { name, exact: true }) });
  await expect(row).toContainText("사용 문서 2개");
  await expect(row.getByRole("link")).toHaveCount(2);
  await expect(view.locator(".attachment-list > li").filter({ hasText: unusedName })).toContainText("사용 중인 문서 없음");
  await view.getByRole("searchbox", { name: "파일 이름" }).fill(name.toUpperCase());
  await view.getByRole("search", { name: "첨부파일 검색" }).getByRole("button", { name: "검색" }).click();
  await expect(view.locator(".attachment-list > li")).toHaveCount(1);
  expect(await view.evaluate(() => document.documentElement.scrollWidth)).toBe(360);
  await row.getByRole("link", { name: first }).click();
  await expect(view).toHaveURL(`/s/notice/${first}`);

  const replacement = `코드 예시만 남음\n\n\`\`\`md\n[예시](${url})\n\`\`\``;
  expect((await page.request.put(`${api}/pages/${first}`, { data: { title: first, content: replacement } })).ok()).toBe(true);
  await view.goto(listing);
  await expect(row.getByRole("link")).toHaveCount(1);
  const deleted = await page.request.delete(`${api}/pages/${second}`);
  expect(deleted.ok()).toBe(true);
  await view.reload();
  await expect(row).toContainText("사용 중인 문서 없음");
  const { trashId } = await deleted.json();
  expect((await page.request.post(`${api}/trash/${trashId}/restore`)).ok()).toBe(true);
  await view.reload();
  await expect(row.getByRole("link", { name: second })).toBeVisible();
  await reader.close();
});

test("다른 스페이스의 파일과 사용처를 공개 목록에 노출하지 않는다", async ({ page, browser }) => {
  await login(page, "wiki-admin", "admin1234");
  const prefix = `private-${Date.now()}`;
  const publicUrl = await upload(page, "notice", `${prefix}-public.pdf`);
  const privateName = `${prefix}-secret.pdf`;
  const privateUrl = await upload(page, "eng", privateName);
  const privateTitle = `${prefix}-private-page`;
  await create(page, "eng", privateTitle, `[공개 파일](${publicUrl})\n\n[제한 파일](${privateUrl})`);
  await create(page, "notice", `${prefix}-public-page`, `[다른 스페이스](${privateUrl})`);
  const reader = await browser.newContext();
  const view = await reader.newPage();
  await login(view, "bob", "bob1234");
  await view.goto(`/s/notice/-/attachments?q=${prefix}`);
  await expect(view.locator(".attachment-list > li")).toHaveCount(1);
  await expect(view.getByRole("main")).toContainText("사용 중인 문서 없음");
  await expect(view.getByRole("main")).not.toContainText(privateName);
  await expect(view.getByRole("main")).not.toContainText(privateTitle);
  await view.goto(`/s/notice/-/attachments?q=${privateName}`);
  await expect(view.getByText("일치하는 파일이 없습니다.")).toBeVisible();
  await view.goto("/s/eng/-/attachments");
  await expect(view.getByRole("heading", { name: "페이지를 찾을 수 없습니다" })).toBeVisible();
  await expect(view.getByRole("heading", { name: "첨부파일", exact: true })).toHaveCount(0);
  await expect(view.getByText(privateName)).toHaveCount(0);
  expect((await view.request.get(privateUrl)).status()).toBe(404);
  await reader.close();
});
