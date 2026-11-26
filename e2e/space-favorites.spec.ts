import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { login } from "./helpers";

async function hasFavoriteMarker(link: Locator) {
  return link.evaluate(element => {
    const marker = getComputedStyle(element, "::before");
    return marker.content !== "none" && marker.content !== "normal" && marker.display !== "none"
      && marker.visibility === "visible" && marker.opacity !== "0";
  });
}

async function showFavorites(sidebar: Locator) {
  const favorites = sidebar.getByRole("group", { name: "내 즐겨찾기", exact: true });
  await expect(favorites).toBeVisible();
  const more = favorites.getByRole("button", { name: /더 보기/ });
  if (await more.isVisible()) await more.click();
  return favorites;
}

async function toggleFavorite(page: Page, group: Locator, space: { name: string; key: string }, add: boolean) {
  const button = group.getByRole("button", { name: `${space.name} 즐겨찾기 ${add ? "추가" : "해제"}`, exact: true });
  const touch = await page.evaluate(() => matchMedia("(pointer: coarse)").matches);
  if (!touch) await group.getByRole("link", { name: space.name }).hover();
  const method = add ? "PUT" : "DELETE";
  const saved = page.waitForResponse(response =>
    new URL(response.url()).pathname === `/api/spaces/${space.key}/favorite` && response.request().method() === method
  );
  if (touch) await button.tap();
  else await button.click();
  expect((await saved).status()).toBe(200);
}

test("계정별 스페이스 즐겨찾기를 검색·모바일 탐색에 반영하고 권한을 잃은 항목을 숨긴다", async ({ page, browser, request }) => {
  const db = new PrismaClient();
  const id = randomUUID().slice(0, 8);
  const term = `Star${id}`;
  const publicFirst = { key: `fav-a-${id}`, name: `${term} A 공개`, visibility: "organization" } as const;
  const publicLast = { key: `fav-z-${id}`, name: `${term} Z 공개`, visibility: "organization" } as const;
  const privateFirst = { key: `fav-ai-${id}`, name: `${term} A 내부`, visibility: "restricted" } as const;
  const privateLast = { key: `fav-zi-${id}`, name: `${term} Z 내부`, visibility: "restricted" } as const;
  const spaces = [publicFirst, publicLast, privateFirst, privateLast];
  const adminContext = await browser.newContext();
  const phoneContext = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  try {
    await login(page, "bob", "bob1234");
    const user = await db.user.findUniqueOrThrow({ where: { username: "bob" } });
    const created = await db.space.createManyAndReturn({ data: spaces });
    const privateIds = created.filter(space => space.visibility === "restricted").map(space => space.id);
    await db.spacePermission.createMany({ data: privateIds.map(spaceId => ({
      spaceId, subjectType: "user", subjectRef: user.id, role: "viewer",
    })) });
    await page.goto(`/s/${publicFirst.key}`);
    const sidebar = page.getByRole("complementary", { name: "위키 탐색" });
    const publicGroup = sidebar.getByRole("group", { name: "전체 공개", exact: true });
    const privateGroup = sidebar.getByRole("group", { name: "비공개", exact: true });
    const search = sidebar.getByRole("searchbox", { name: "스페이스 이름 검색" });
    await search.fill(term);
    const currentLink = publicGroup.getByRole("link", { name: publicFirst.name });
    const savedLink = publicGroup.getByRole("link", { name: publicLast.name });
    await expect(currentLink).toHaveAttribute("aria-current", "page");
    await expect.poll(() => hasFavoriteMarker(currentLink)).toBe(false);
    await expect(publicGroup.getByRole("link").first()).toContainText(publicFirst.name);
    await expect(privateGroup.getByRole("link").first()).toContainText(privateFirst.name);
    await page.route(`**/api/spaces/${publicLast.key}/favorite`, route =>
      route.fulfill({ status: 500, contentType: "application/json", body: "{}" }), { times: 1 });
    const addPublic = publicGroup.getByRole("button", { name: `${publicLast.name} 즐겨찾기 추가` });
    await search.hover();
    await expect(addPublic).toHaveCSS("opacity", "0");
    await publicGroup.getByRole("link", { name: publicLast.name }).focus();
    await page.keyboard.press("Tab");
    await expect(addPublic).toBeFocused();
    await expect(addPublic).toHaveCSS("opacity", "1");
    await addPublic.press("Enter");
    await expect(sidebar.getByRole("alert")).toHaveText("즐겨찾기를 변경하지 못했습니다. 다시 시도해 주세요.");
    await expect(addPublic).toBeVisible();
    await expect(publicGroup.getByRole("link").first()).toContainText(publicFirst.name);
    await toggleFavorite(page, publicGroup, publicLast, true);
    await expect(sidebar.getByRole("alert")).toBeHidden();
    await toggleFavorite(page, privateGroup, privateLast, true);
    await expect(publicGroup.getByRole("link").first()).toContainText(publicLast.name);
    await expect(privateGroup.getByRole("link").first()).toContainText(privateLast.name);
    await expect(sidebar.getByRole("link", { name: publicLast.name })).toHaveCount(1);
    await expect(sidebar.getByRole("link", { name: privateLast.name })).toHaveCount(1);
    await search.focus();
    await search.hover();
    await expect.poll(() => hasFavoriteMarker(savedLink)).toBe(true);
    await expect(savedLink).not.toHaveAttribute("aria-current", "page");
    await expect(publicGroup.getByRole("button", { name: `${publicLast.name} 즐겨찾기 해제` })).toHaveCSS("opacity", "0");

    await search.clear();
    const favorites = await showFavorites(sidebar);
    await expect(favorites.getByRole("link", { name: privateLast.name })).toBeVisible();
    await favorites.getByRole("link", { name: publicLast.name }).click();
    await expect(page).toHaveURL(new RegExp(`/s/${publicLast.key}$`));
    await expect(savedLink).toHaveAttribute("aria-current", "page");
    await expect.poll(() => hasFavoriteMarker(savedLink)).toBe(true);
    await page.goBack();
    await expect(page).toHaveURL(new RegExp(`/s/${publicFirst.key}$`));
    await expect((await showFavorites(sidebar)).getByRole("link", { name: publicLast.name })).toBeVisible();
    await page.reload();
    await expect((await showFavorites(sidebar)).getByRole("link", { name: publicLast.name })).toBeVisible();

    const admin = await adminContext.newPage();
    await login(admin, "wiki-admin", "admin1234");
    const adminSidebar = admin.getByRole("complementary", { name: "위키 탐색" });
    await adminSidebar.getByRole("searchbox", { name: "스페이스 이름 검색" }).fill(term);
    await expect(adminSidebar.getByRole("button", { name: `${publicLast.name} 즐겨찾기 추가` })).toBeVisible();
    await expect(adminSidebar.getByRole("group", { name: "전체 공개" }).getByRole("link").first()).toContainText(publicFirst.name);

    const phone = await phoneContext.newPage();
    await login(phone, "bob", "bob1234");
    const openNav = phone.getByRole("button", { name: "위키 탐색 열기" });
    const mobileNav = phone.getByRole("complementary", { name: "위키 탐색" });
    await openNav.tap();
    const mobileFavorites = await showFavorites(mobileNav);
    const privateShortcut = mobileFavorites.getByRole("link", { name: privateLast.name });
    await expect.poll(() => hasFavoriteMarker(privateShortcut)).toBe(true);
    await expect(mobileFavorites.getByRole("button", { name: `${privateLast.name} 즐겨찾기 해제` })).toBeHidden();
    await privateShortcut.tap();
    await expect(phone).toHaveURL(new RegExp(`/s/${privateLast.key}$`));
    await expect(mobileNav).toBeHidden();
    await openNav.tap();
    await mobileNav.getByRole("button", { name: "즐겨찾기 편집", exact: true }).tap();
    await toggleFavorite(phone, await showFavorites(mobileNav), publicLast, false);
    await mobileNav.getByRole("searchbox", { name: "스페이스 이름 검색" }).fill(term);
    const mobilePublic = mobileNav.getByRole("group", { name: "전체 공개", exact: true });
    const mobilePrivate = mobileNav.getByRole("group", { name: "비공개", exact: true });
    await expect.poll(() => hasFavoriteMarker(mobilePublic.getByRole("link", { name: publicLast.name }))).toBe(false);
    await toggleFavorite(phone, mobilePrivate, privateFirst, true);
    await mobileNav.getByRole("button", { name: "완료", exact: true }).tap();
    await expect.poll(() => hasFavoriteMarker(mobilePrivate.getByRole("link", { name: privateFirst.name }))).toBe(true);
    await expect(mobilePrivate.getByRole("button", { name: `${privateFirst.name} 즐겨찾기 해제` })).toBeHidden();
    await expect(phone).toHaveURL(new RegExp(`/s/${privateLast.key}$`));
    await expect(mobileNav).toBeVisible();

    await page.reload();
    await expect((await showFavorites(sidebar)).getByRole("link", { name: publicLast.name })).toHaveCount(0);
    await search.fill(term);
    await expect(publicGroup.getByRole("link").first()).toContainText(publicFirst.name);

    const restrictedId = created.find(space => space.key === privateLast.key)!.id;
    await db.spacePermission.deleteMany({ where: { spaceId: restrictedId, subjectRef: user.id } });
    await page.reload();
    await expect(sidebar.getByRole("link", { name: privateLast.name })).toHaveCount(0);
    await search.fill(term);
    await expect(privateGroup.getByRole("link")).toHaveCount(1);
    const endpoint = `/api/spaces/${privateLast.key}/favorite`;
    expect((await page.request.put(endpoint)).status()).toBe(404);
    expect((await request.put(endpoint)).status()).toBe(401);
  } finally {
    await Promise.all([phoneContext.close(), adminContext.close()]);
    await db.space.deleteMany({ where: { key: { in: spaces.map(space => space.key) } } });
    await db.$disconnect();
  }
});

test("즐겨찾기가 많으면 세 개를 먼저 보여주고 전체 목록을 펼칠 수 있다", async ({ page }) => {
  const db = new PrismaClient();
  const id = randomUUID().slice(0, 8);
  const spaces = [1, 2, 3, 4].map(index => ({
    key: `fav-more-${id}-${index}`, name: `Star${id} ${index}`,
  }));
  try {
    await db.space.createMany({ data: spaces });
    await login(page, "bob", "bob1234");
    for (const space of spaces) {
      expect((await page.request.put(`/api/spaces/${space.key}/favorite`)).status()).toBe(200);
    }
    const repeated = `/api/spaces/${spaces[0].key}/favorite`;
    expect((await page.request.put(repeated)).status()).toBe(200);
    await page.reload();
    const favorites = page.getByRole("group", { name: "내 즐겨찾기", exact: true });
    await expect(favorites.getByRole("link")).toHaveCount(3);
    await favorites.getByRole("button", { name: /더 보기/ }).click();
    for (const space of spaces) {
      await expect(favorites.getByRole("link", { name: space.name })).toHaveCount(1);
    }
    await favorites.getByRole("button", { name: /접기/ }).click();
    await expect(favorites.getByRole("link")).toHaveCount(3);
    expect((await page.request.delete(repeated)).status()).toBe(200);
    expect((await page.request.delete(repeated)).status()).toBe(200);
  } finally {
    await db.space.deleteMany({ where: { key: { in: spaces.map(space => space.key) } } });
    await db.$disconnect();
  }
});
