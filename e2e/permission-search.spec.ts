import { PrismaClient } from "@prisma/client";
import { expect, test } from "@playwright/test";
import { login } from "./helpers";

test("통합 권한 검색은 같은 이름의 사용자·그룹을 구분하고 키보드와 모바일에서 저장한다", async ({ page, browser, request }) => {
  test.slow();
  page.setDefaultTimeout(15_000);
  const db = new PrismaClient();
  const marker = `unified-${Date.now()}`;
  const label = `통합 검색 ${marker}`;
  const space = await db.space.create({ data: { key: marker, name: "통합 권한 검사", visibility: "restricted" } });
  const user = await db.user.create({ data: { id: marker, username: marker, name: label, email: `${marker}@example.com` } });
  const group = await db.wikiGroup.create({ data: { name: label } });
  const reader = await browser.newContext();
  const endpoint = `/api/spaces/${space.key}/permission-subjects`;
  try {
    await login(page, "wiki-admin", "admin1234");
    await page.goto(`/s/${space.key}/settings`);
    const form = page.getByRole("form", { name: "권한 추가", exact: true });
    const input = form.getByRole("combobox", { name: "사용자 또는 그룹", exact: true });
    const add = form.getByRole("button", { name: "권한 추가", exact: true });
    await expect(add).toBeDisabled();

    // 검색 실패 후 같은 검색어로 재시도할 수 있다.
    await page.route(`**${endpoint}?**`, route => route.fulfill({ status: 503, body: "Unavailable" }), { times: 1 });
    await input.fill(label);
    await form.getByRole("button", { name: "다시 시도", exact: true }).click();
    const options = page.getByRole("listbox", { name: "사용자·그룹 검색 결과" }).getByRole("option");
    await expect(options).toHaveCount(2);
    await expect(options.filter({ hasText: "멤버 0명" })).toContainText("그룹");
    await expect(options.filter({ hasText: user.email })).toContainText("사용자");
    // 한두 글자는 접두 검색, 세 글자 이상의 단어는 부분 검색도 지원한다.
    await input.fill("검색");
    await expect(form.getByText(/검색 결과가 없습니다/)).toBeVisible();
    await input.fill(`검색 ${marker}`);
    await expect(options).toHaveCount(2);
    await expect(add).toBeDisabled();
    await input.press("Enter");
    await expect(page.getByRole("row").filter({ hasText: label })).toHaveCount(0);

    // 공백을 덧붙여도 다시 검색되며, 좁은 화면에서 목록이 넘치지 않는다.
    await input.fill(` ${label} `);
    await expect(options).toHaveCount(2);
    for (const width of [1440, 390, 320]) {
      await page.setViewportSize({ width, height: 900 });
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
      const box = await page.getByRole("listbox").boundingBox();
      expect(box!.x).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width).toBeLessThanOrEqual(width);
    }
    await page.screenshot({ path: "output/playwright/permission-search-mobile.png", fullPage: true });
    await input.press("Escape");
    await expect(page.getByRole("listbox")).toHaveCount(0);
    await input.press("ArrowDown");
    await expect(options.first()).toContainText("그룹");
    await input.press("Enter");
    await expect(form.locator('input[name="subjectType"]')).toHaveValue("group");
    await expect(add).toBeEnabled();
    await form.getByRole("combobox", { name: "역할", exact: true }).selectOption("editor");
    await add.click();
    await expect(page.getByRole("row").filter({ hasText: label }).locator(".settings-role")).toHaveText("편집");
    await expect(input).toHaveValue("");

    // 이메일·아이디는 대소문자를 구분하지 않으며, 표시 이름이 같아도 id로 저장한다.
    await input.fill(user.email.toUpperCase());
    await expect(options).toHaveCount(1);
    await options.first().click();
    await form.getByRole("button", { name: "선택한 대상 지우기" }).click();
    await expect(add).toBeDisabled();
    await input.fill(marker.toUpperCase());
    await options.filter({ hasText: user.email }).click();
    await form.getByRole("combobox", { name: "역할", exact: true }).selectOption("viewer");
    await add.click();
    await expect(page.getByRole("row").filter({ hasText: label })).toHaveCount(2);
    const grants = await db.spacePermission.findMany({ where: { spaceId: space.id } });
    expect(grants.map(p => [p.subjectType, p.subjectRef, p.role])).toEqual(expect.arrayContaining([
      ["group", group.id, "editor"], ["user", user.id, "viewer"],
    ]));

    // 선택한 그룹이 그 사이 삭제되어도 권한이 생기지 않고 폼에서 원인을 알린다.
    await input.fill(label);
    await options.filter({ hasText: "멤버 0명" }).click();
    await db.spacePermission.deleteMany({ where: { spaceId: space.id, subjectType: "group" } });
    await db.wikiGroup.delete({ where: { id: group.id } });
    await form.getByRole("button", { name: "권한 변경", exact: true }).click();
    await expect(form.getByRole("alert")).toContainText("더 이상 존재하지 않습니다");
    expect(await db.spacePermission.count({ where: { spaceId: space.id, subjectType: "group" } })).toBe(0);

    await input.fill(`없는대상-${marker}`);
    await expect(form.getByText(/검색 결과가 없습니다/)).toBeVisible();
    await expect(add).toBeDisabled();

    // 디렉터리는 스페이스 관리 권한을 가진 사용자에게만 노출한다.
    expect((await request.get(`${endpoint}?q=${marker}`)).status()).toBe(401);
    const bob = await reader.newPage();
    await login(bob, "bob", "bob1234");
    expect((await bob.request.get(`${endpoint}?q=${marker}`)).status()).toBe(404);
    const bobUser = await db.user.findUniqueOrThrow({ where: { username: "bob" } });
    const permission = await db.spacePermission.create({ data: { spaceId: space.id, subjectType: "user", subjectRef: bobUser.id, role: "editor" } });
    expect((await bob.request.get(`${endpoint}?q=${marker}`)).status()).toBe(403);
    await db.spacePermission.update({ where: { id: permission.id }, data: { role: "admin" } });
    const allowed = await bob.request.get(`${endpoint}?q=${marker}`);
    expect(allowed.status()).toBe(200);
    expect(allowed.headers()["cache-control"]).toBe("private, no-store");
    expect((await allowed.json()).items).toEqual([expect.objectContaining({ id: user.id, type: "user", currentRole: "viewer" })]);

    await db.user.create({ data: { id: `${marker}-extra`, username: `${marker}-extra`, name: "AAA prefix candidate" } });
    const ranked = await (await bob.request.get(`${endpoint}?q=${marker}`)).json();
    expect(ranked.items[0].id).toBe(user.id);

    // 그룹을 통해 받은 관리 권한도 필터링한 권한 조회에 포함되어야 한다.
    await db.wikiGroup.create({ data: { id: group.id, name: label, members: { create: { userId: bobUser.id } } } });
    await db.spacePermission.create({ data: { spaceId: space.id, subjectType: "group", subjectRef: group.id, role: "admin" } });
    await db.spacePermission.delete({ where: { id: permission.id } });
    expect((await bob.request.get(`${endpoint}?q=${marker}`)).status()).toBe(200);

    // 빈 검색은 전체 명단을 내리지 않고 결과 수를 제한한다.
    expect(await (await page.request.get(endpoint)).json()).toEqual({ items: [], hasMore: false });
    await db.wikiGroup.createMany({ data: Array.from({ length: 12 }, (_, index) => ({ name: `${marker}-limit-${index}` })) });
    const limited = await (await page.request.get(`${endpoint}?q=${marker}-limit`)).json();
    expect(limited.items).toHaveLength(10);
    expect(limited.hasMore).toBe(true);
    expect((await page.request.get(`${endpoint}?q=${"x".repeat(101)}`)).status()).toBe(400);
    expect((await (await page.request.get(`${endpoint}?q=${marker}%25`)).json()).items).toEqual([]);
  } finally {
    await reader.close();
    await db.space.delete({ where: { id: space.id } });
    await db.wikiGroup.deleteMany({ where: { OR: [{ id: group.id }, { name: { startsWith: `${marker}-limit-` } }] } });
    await db.user.deleteMany({ where: { id: { in: [user.id, `${marker}-extra`] } } });
    await db.$disconnect();
  }
});

test("큰 그룹의 멤버 수는 제한해서 집계한다", async ({ page }) => {
  const db = new PrismaClient();
  const marker = `member-cap-${Date.now()}`;
  const space = await db.space.create({ data: { key: marker, name: "멤버 수 상한 검사" } });
  const group = await db.wikiGroup.create({ data: { name: marker } });
  const ids = Array.from({ length: 1001 }, (_, n) => `${marker}-${n}`);
  try {
    await db.user.createMany({ data: ids.map(id => ({ id })) });
    await db.wikiGroupMember.createMany({ data: ids.map(userId => ({ userId, groupId: group.id })) });
    await login(page, "wiki-admin", "admin1234");
    const result = await (await page.request.get(`/api/spaces/${space.key}/permission-subjects?q=${marker}`)).json();
    expect(result.items).toEqual([expect.objectContaining({ type: "group", id: group.id, detail: "멤버 1,000명 이상" })]);
  } finally {
    await db.space.delete({ where: { id: space.id } });
    await db.wikiGroup.delete({ where: { id: group.id } });
    await db.user.deleteMany({ where: { id: { in: ids } } });
    await db.$disconnect();
  }
});
