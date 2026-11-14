import { expect, test } from "@playwright/test";
import { login } from "./helpers";

test("스페이스 검색을 끝까지 탐색하고 범위 전환·권한·휴지통을 웹과 API에서 검증한다", async ({ page, browser }) => {
  test.setTimeout(120_000);
  await login(page, "wiki-admin", "admin1234");
  const marker = `paging${Date.now()}`;
  const api = async (q: string, space?: string, n?: string) => {
    const params = new URLSearchParams({ q });
    if (space) params.set("space", space);
    if (n) params.set("page", n);
    return page.request.get(`/api/search?${params}`);
  };
  // 같은 점수를 갖는 문서 51개로 기존 API 상한의 바로 다음 문서까지 검사한다.
  for (let start = 0; start < 51; start += 8) {
    const batch = Array.from({ length: Math.min(8, 51 - start) }, (_, i) => {
      const title = `문서-${marker}-${start + i}`;
      return page.request.post("/api/spaces/notice/pages", { data: { title, content: marker } });
    });
    for (const res of await Promise.all(batch)) expect(res.status()).toBe(201);
  }
  const privateTitle = `비공개-${marker}`;
  expect((await page.request.post("/api/spaces/eng/pages", { data: { title: privateTitle, content: marker } })).status()).toBe(201);

  const results = page.locator(".results-list li a");
  await page.goto("/s/notice");
  const search = page.getByRole("searchbox", { name: "문서 검색" });
  await search.fill(marker);
  await search.press("Enter");
  await expect(page.getByLabel("검색 범위")).toHaveValue("notice");
  await expect(page.getByRole("heading", { name: "검색 결과 · 51건" })).toBeVisible();
  await expect(results).toHaveCount(20);
  const first = await results.allTextContents();
  const nav = page.getByRole("navigation", { name: "검색 결과 페이지" });
  await nav.getByRole("link", { name: "다음" }).click();
  await expect(nav).toContainText("2 / 3");
  const second = await results.allTextContents();
  await nav.getByRole("link", { name: "다음" }).click();
  await expect(results).toHaveCount(11);
  const third = await results.allTextContents();
  expect(new Set([...first, ...second, ...third]).size).toBe(51);
  await expect(nav.getByRole("link", { name: "다음" })).toHaveCount(0);
  await page.reload();
  await expect(results).toHaveText(third);
  await nav.getByRole("link", { name: "이전" }).click();
  await expect(results).toHaveText(second);

  await page.getByLabel("검색 범위").selectOption("");
  await page.getByRole("button", { name: "적용" }).click();
  await expect(page.getByRole("heading", { name: "검색 결과 · 52건" })).toBeVisible();
  await expect(nav).toContainText("1 / 3");
  await page.getByLabel("검색 범위").selectOption("eng");
  await page.getByRole("button", { name: "적용" }).click();
  await expect(results).toHaveText([privateTitle]);
  await expect(search).toHaveValue(marker);

  const all = await (await api(marker)).json();
  expect(all).toMatchObject({ query: marker, page: 1, pageSize: 50, total: 52, totalPages: 2 });
  const scoped = await (await api(marker, "notice")).json();
  const last = await (await api(marker, "notice", "2")).json();
  expect(scoped.results).toHaveLength(50);
  expect(last).toMatchObject({ page: 2, total: 51, totalPages: 2 });
  expect(last.results).toHaveLength(1);
  expect(new Set([...scoped.results, ...last.results].map(r => r.slug)).size).toBe(51);
  expect((await (await api(marker, "notice", "99999")).json()).results).toEqual(last.results);
  expect((await api(marker, "notice", "0")).status()).toBe(400);
  expect(await (await api(marker + "absent", "notice")).json()).toMatchObject({ results: [], page: 1, totalPages: 0, total: 0 });

  const gone = last.results[0].slug;
  expect((await page.request.delete(`/api/spaces/notice/pages/${encodeURIComponent(gone)}`)).ok()).toBe(true);
  const afterDelete = await (await api(marker, "notice", "2")).json();
  expect(afterDelete).toMatchObject({ total: 50, page: 1, totalPages: 1 });
  expect(afterDelete.results.map((r: { slug: string }) => r.slug)).not.toContain(gone);

  await page.goto(`/search?q=${marker}&space=notice&page=99999`);
  await expect(page).toHaveURL(new RegExp("space=notice&page=3$"));
  await search.fill(privateTitle);
  await search.press("Enter");
  await expect(page.getByText("결과가 없습니다.")).toBeVisible();
  expect(new URL(page.url()).searchParams.has("page")).toBe(false);

  const viewer = await browser.newContext();
  try {
    const bob = await viewer.newPage();
    await login(bob, "bob", "bob1234");
    const visible = await (await bob.request.get(`/api/search?q=${marker}`)).json();
    expect(visible.total).toBe(50);
    const denied = await bob.request.get(`/api/search?q=${marker}&space=eng&page=2`);
    const missing = await bob.request.get(`/api/search?q=${marker}&space=no-such-space&page=2`);
    expect(denied.status()).toBe(404);
    expect(await denied.json()).toEqual(await missing.json());
    await bob.goto(`/search?q=${marker}&space=eng`);
    await expect(bob.locator(".results-list")).toHaveCount(0);
    await expect(bob.getByText(privateTitle, { exact: true })).toHaveCount(0);
    await bob.goto(`/search?q=${marker}&from=notice`);
    await expect(bob.getByLabel("검색 범위")).toHaveValue("");
    await expect(bob.locator("#search-scope option[value=eng]")).toHaveCount(0);
  } finally {
    await viewer.close();
  }
});
