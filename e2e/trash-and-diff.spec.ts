import { test, expect, type Page } from "@playwright/test";
import { login } from "./helpers";

const api = "/api/spaces/notice";
async function create(page: Page, title: string, content = "", parent?: string) {
  const res = await page.request.post(`${api}/pages`, { data: { title, content, parent } });
  expect(res.status()).toBe(201);
  return (await res.json()).slug as string;
}
async function parentOf(page: Page, slug: string) {
  const { pages } = await (await page.request.get(`${api}/pages`)).json();
  return pages.find((p: { slug: string }) => p.slug === slug)?.parentSlug;
}
test("삭제한 문서를 검색·API에서 숨기고 이력·댓글·좋아요·트리 위치를 복원한다", async ({ page }) => {
  await login(page, "wiki-admin", "admin1234");
  const id = Date.now();
  const root = await create(page, `root-${id}`);
  const slug = await create(page, `trashed-${id}`, "초기 원문", root);
  const child = await create(page, `child-${id}`, "", slug);
  const moved = await create(page, `moved-${id}`, "", slug);
  const ref = await create(page, `references-${id}`, `[[${slug}]]`);
  const path = `/s/notice/${slug}`;
  expect((await page.request.put(`${api}/pages/${slug}`, { data: { title: slug, content: "수정 원문" } })).ok()).toBe(true);
  await page.goto(path);
  await page.getByRole("button", { name: "좋아요", exact: true }).click();
  await page.getByPlaceholder("댓글을 남겨보세요").fill("복원할 댓글");
  await page.getByRole("button", { name: "댓글 작성" }).click();
  await expect(page.getByText("복원할 댓글", { exact: true })).toBeVisible();
  const search = async () => (await (await page.request.get(`/api/search?q=${slug}`)).json()).results;
  expect(await search()).toContainEqual(expect.objectContaining({ slug }));
  await page.getByRole("button", { name: "문서 더보기" }).click();
  page.once("dialog", d => d.accept());
  await page.getByRole("button", { name: "삭제", exact: true }).first().click();
  await expect(page).toHaveURL("/s/notice");
  expect(await search()).not.toContainEqual(expect.objectContaining({ slug }));
  expect(await parentOf(page, slug)).toBeUndefined();
  expect(await parentOf(page, child)).toBe(root);
  for (const suffix of ["", "?version=1", "/revisions"]) {
    expect((await page.request.get(`${api}/pages/${slug}${suffix}`)).status()).toBe(404);
  }
  expect((await page.request.post(`${api}/pages/${moved}/move`, { data: { parent: null } })).ok()).toBe(true);
  await page.goto(`/s/notice/${ref}`);
  await expect(page.locator("article a.wiki-link-missing")).toHaveText(slug);
  await page.goto("/s/notice");
  await page.getByRole("link", { name: "휴지통" }).click();
  const row = page.locator(".trash-list li").filter({ hasText: slug });
  await expect(row).toContainText(root);
  await row.getByRole("button", { name: "복원" }).click();
  await expect(page).toHaveURL(path);
  await expect(page.getByText("수정 원문", { exact: true })).toBeVisible();
  await expect(page.getByText("복원할 댓글", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "좋아요 취소" })).toHaveAttribute("aria-pressed", "true");
  expect(await parentOf(page, child)).toBe(slug);
  expect(await parentOf(page, moved)).toBeNull();
  expect((await (await page.request.get(`${api}/pages/${slug}?version=1`)).json()).content).toBe("초기 원문");
  expect(await search()).toContainEqual(expect.objectContaining({ slug }));
});

test("같은 주소로 만든 문서를 덮어쓰지 않고 원래 문서를 다른 주소로 복원한다", async ({ page }) => {
  await login(page, "wiki-admin", "admin1234");
  const slug = await create(page, `collision-${Date.now()}`, "복원 원문");
  const deleted = await (await page.request.delete(`${api}/pages/${slug}`)).json();
  await create(page, slug, "새 문서");
  expect((await page.request.post(`${api}/trash/${deleted.trashId}/restore`)).status()).toBe(409);
  expect((await page.request.post(`/api/spaces/eng/trash/${deleted.trashId}/restore`)).status()).toBe(404);
  await page.goto("/s/notice/-/trash");
  const row = page.locator(".trash-list li").filter({ hasText: slug });
  await row.getByRole("button", { name: "복원" }).click();
  await expect(row.getByRole("alert")).toContainText("주소를 다른 문서");
  await row.getByLabel("복원할 주소").fill(`${slug}-old`);
  await row.getByRole("button", { name: "복원" }).click();
  await expect(page).toHaveURL(`/s/notice/${slug}-old`);
  await expect(page.getByText("복원 원문", { exact: true })).toBeVisible();
  expect((await (await page.request.get(`${api}/pages/${slug}`)).json()).content).toBe("새 문서");
  expect((await page.request.post(`${api}/trash/${deleted.trashId}/restore`)).status()).toBe(404);
});

test("열람자는 두 리비전의 제목·본문을 비교할 수 있고 휴지통은 편집 권한이 필요하다", async ({ page, browser }) => {
  await login(page, "wiki-admin", "admin1234");
  const slug = await create(page, `diff-${Date.now()}`, "문맥\n이전 문장\n");
  for (const content of ["중간 문장\n", "문맥\n새 문장\n"]) {
    expect((await page.request.put(`${api}/pages/${slug}`, { data: { title: "최종 제목", content } })).ok()).toBe(true);
  }
  const ctx = await browser.newContext();
  const viewer = await ctx.newPage();
  await login(viewer, "bob", "bob1234");
  await viewer.goto(`/s/notice/${slug}`);
  await viewer.getByRole("link", { name: "이력", exact: true }).click();
  await viewer.getByLabel("기준 버전").selectOption("1");
  await viewer.getByLabel("비교 버전").selectOption("3");
  await viewer.getByRole("button", { name: "버전 비교" }).click();
  const diff = viewer.getByRole("region", { name: "버전 비교 결과" });
  await expect(diff).toContainText("v1 → v3");
  await expect(diff).toContainText(slug);
  await expect(diff).toContainText("최종 제목");
  await expect(diff.locator(".diff-add")).toContainText("+ 새 문장");
  await expect(diff.locator(".diff-remove")).toContainText("− 이전 문장");
  await viewer.reload();
  await expect(diff).toBeVisible();
  const trash = await (await page.request.delete(`${api}/pages/${slug}`)).json();
  expect((await viewer.request.get(`${api}/trash`)).status()).toBe(403);
  expect((await viewer.request.post(`${api}/trash/${trash.trashId}/restore`)).status()).toBe(403);
  await viewer.reload();
  await expect(diff).toHaveCount(0);
  expect((await page.request.post(`${api}/trash/${trash.trashId}/restore`)).status()).toBe(200);
  await ctx.close();
});
