import { PrismaClient } from "@prisma/client";
import { expect as baseExpect, test, type Page } from "@playwright/test";
import { login } from "./helpers";

// 로컬 인증·DB 응답을 포함하는 관리 작업은 첫 호출에 15초를 넘길 수 있다.
const expect = baseExpect.configure({ timeout: 45_000 });

async function checkLayout(page: Page) {
  for (const width of [1440, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
    const main = await page.locator("main").boundingBox();
    expect(main!.x).toBeGreaterThanOrEqual(16);
    await expect(page.getByRole("navigation", { name: "설정 메뉴" }).locator('[aria-current="page"]')).toHaveCount(1);
  }
}

test("관리 화면에서 스페이스와 그룹을 만들고 모바일에서 사용자·그룹 권한을 설정한다", async ({ page, browser }) => {
  test.setTimeout(300_000);
  const db = new PrismaClient();
  const marker = Date.now();
  const key = `admin-${marker}`;
  const name = "운영팀 배포와 장애 대응 절차를 함께 관리하는 스페이스";
  const groupName = `운영팀 배포 담당자 ${marker}`;
  const reader = await browser.newContext();
  try {
    const bob = await reader.newPage();
    await login(bob, "bob", "bob1234");
    await login(page, "wiki-admin", "admin1234");
    await page.goto("/groups");
    const nav = page.getByRole("navigation", { name: "설정 메뉴" });
    await nav.getByRole("link", { name: "새 스페이스", exact: true }).click();
    await checkLayout(page);
    await page.getByLabel("키 (URL용, 소문자/숫자/하이픈)").fill(key);
    await page.getByLabel("이름", { exact: true }).fill(name);
    await page.getByLabel("공개 범위").selectOption("restricted");
    await page.getByRole("button", { name: "만들기", exact: true }).click();
    await expect(page.getByRole("heading", { name, exact: true })).toBeVisible();

    await page.getByRole("button", { name: "위키 탐색 열기" }).click();
    await page.getByRole("complementary", { name: "위키 탐색" }).getByRole("link", { name: "스페이스 설정", exact: true }).click();
    await expect(page.getByRole("complementary", { name: "위키 탐색" })).toBeHidden();
    await nav.getByRole("link", { name: "그룹 관리", exact: true }).click();
    await page.getByLabel("새 그룹 이름").fill(groupName);
    await page.getByRole("button", { name: "그룹 만들기", exact: true }).click();
    const group = page.getByRole("region", { name: groupName });
    await group.getByLabel("멤버 추가 (이메일 또는 아이디)").fill("bob");
    await group.getByRole("button", { name: "멤버 추가", exact: true }).click();
    await expect(group.getByRole("cell", { name: /bob@example\.com/ })).toBeVisible();
    await checkLayout(page);
    await page.screenshot({ path: "output/playwright/admin-groups-after-mobile.png", fullPage: true });

    await page.goto(`/s/${key}/settings`);
    const groupForm = page.getByRole("form", { name: "그룹 권한 추가" });
    await groupForm.getByLabel("그룹", { exact: true }).selectOption({ label: groupName });
    await groupForm.getByLabel("역할").selectOption("editor");
    await groupForm.getByRole("button", { name: "그룹 권한 추가" }).click();
    const row = page.getByRole("row").filter({ hasText: groupName });
    await expect(row.locator(".settings-role")).toHaveText("편집");
    expect((await bob.request.post(`/api/spaces/${key}/pages`, { data: { title: "권한 검사" } })).status()).toBe(201);
    await checkLayout(page);

    // 같은 그룹의 역할을 바꾸는 기존 동작과 즉시 권한 반영을 확인한다.
    await groupForm.getByLabel("그룹", { exact: true }).selectOption({ label: groupName });
    await groupForm.getByLabel("역할").selectOption("viewer");
    await groupForm.getByRole("button", { name: "그룹 권한 추가" }).click();
    await expect(row.locator(".settings-role")).toHaveText("읽기");
    expect((await bob.request.post(`/api/spaces/${key}/pages`, { data: { title: "생성 불가" } })).status()).toBe(403);

    const userForm = page.getByRole("form", { name: "사용자 권한 추가" });
    await userForm.getByLabel("사용자 (이메일 또는 아이디)").fill("bob");
    await userForm.getByLabel("역할").selectOption("admin");
    await userForm.getByRole("button", { name: "사용자 권한 추가" }).click();
    await bob.goto(`/s/${key}/settings`);
    await expect(bob.getByRole("heading", { name: name + " 설정", exact: true })).toBeVisible();
    await expect(bob.getByRole("navigation", { name: "설정 메뉴" }).getByRole("link", { name: "그룹 관리" })).toHaveCount(0);
    await expect(bob.getByRole("button", { name: "스페이스 삭제" })).toHaveCount(0);
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.screenshot({ path: "output/playwright/admin-settings-after-desktop.png", fullPage: true });

    const visibility = page.getByRole("combobox", { name: "공개 범위" });
    await visibility.selectOption("organization");
    await page.getByRole("button", { name: "저장", exact: true }).click();
    await page.reload();
    await expect(visibility).toHaveValue("organization");
    const userRow = page.getByRole("row").filter({ hasText: "bob@example.com" });
    page.once("dialog", dialog => dialog.accept());
    await userRow.getByRole("button", { name: "삭제", exact: true }).click();
    await expect(userRow).toHaveCount(0);
    await page.reload();
    await expect(userRow).toHaveCount(0);
  } finally {
    await reader.close();
    await db.space.deleteMany({ where: { key } });
    await db.wikiGroup.deleteMany({ where: { name: groupName } });
    await db.$disconnect();
  }
});

test("개인 설정의 모바일 탐색과 토큰 발급·폐기 동작을 확인한다", async ({ page, request }) => {
  test.slow();
  const db = new PrismaClient();
  const marker = Date.now();
  const tokenName = `settings-${marker}`;
  const space = await db.space.create({ data: { key: `token-${marker}`, name: "긴 이름으로 모바일 범위 선택을 확인하는 스페이스" } });
  try {
    await login(page, "bob", "bob1234");
    await page.goto("/settings/tokens");
    const nav = page.getByRole("navigation", { name: "설정 메뉴" });
    await expect(nav.getByRole("link")).toHaveCount(1);
    await checkLayout(page);
    await page.getByRole("button", { name: "위키 탐색 열기" }).click();
    await expect(page.getByRole("complementary", { name: "위키 탐색" })).toBeVisible();
    await page.getByRole("button", { name: "탐색 닫기" }).click();
    await page.getByLabel("토큰 이름 (예: MCP 서버)").fill(tokenName);
    await page.getByLabel("토큰 권한").selectOption("read");
    await page.getByLabel("스페이스 범위").selectOption(space.id);
    await page.getByRole("button", { name: "토큰 발급", exact: true }).click();
    const token = await page.getByTestId("new-token").innerText();
    const headers = { Authorization: `Bearer ${token}` };
    expect((await request.get(`/api/spaces/${space.key}/pages`, { headers })).status()).toBe(200);
    expect((await request.post(`/api/spaces/${space.key}/pages`, { headers, data: { title: "쓰기 불가" } })).status()).toBe(403);
    await page.reload();
    const row = page.getByRole("row").filter({ hasText: tokenName });
    await expect(row).toContainText("읽기 전용");
    await expect(row).toContainText(space.name);
    await checkLayout(page);
    await page.screenshot({ path: "output/playwright/admin-tokens-after-mobile.png", fullPage: true });
    page.once("dialog", dialog => dialog.accept());
    await row.getByRole("button", { name: "삭제", exact: true }).click();
    await expect(row).toHaveCount(0);
    expect((await request.get(`/api/spaces/${space.key}/pages`, { headers })).status()).toBe(401);
  } finally {
    await db.apiToken.deleteMany({ where: { name: tokenName } });
    await db.space.delete({ where: { id: space.id } });
    await db.$disconnect();
  }
});
