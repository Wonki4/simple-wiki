import { PrismaClient } from "@prisma/client";
import { expect, test, type Page } from "@playwright/test";
import { login } from "./helpers";

const backlinks = (page: Page) => page.locator("main aside").filter({ hasText: "이 페이지를 링크한 문서" }).getByRole("link");

async function expectBacklinks(page: Page, titles: string[]) {
  await expect.poll(async () => (await backlinks(page).allTextContents()).sort()).toEqual([...titles].sort());
}

test("일반 마크다운 백링크가 현재 본문과 열람 권한을 따르고 기존 문서에도 표시된다", async ({ page, browser }) => {
  test.slow();
  const db = new PrismaClient();
  const id = Date.now();
  const [space, secret] = await db.$transaction([
    db.space.create({ data: { key: `links-${id}`, name: "백링크 검사" } }),
    db.space.create({ data: { key: `hidden-${id}`, name: "비공개 원본", visibility: "restricted" } }),
  ]);
  const target = "배포-가이드";
  const path = `/s/${space.key}/${target}`;
  const api = `/api/spaces/${space.key}/pages`;
  const reader = await browser.newContext();
  try {
    // 변경 전에 만들어져 PageLink 색인이 없는 문서도 다시 저장할 필요가 없어야 한다.
    const by = { createdById: "fixture", updatedById: "fixture" };
    await db.page.createMany({ data: [
      { ...by, spaceId: space.id, slug: target, title: "배포 가이드", content: "## 설치\n\n[같은 문서](#설치)" },
      { ...by, spaceId: space.id, slug: "checklist", title: "출시 체크리스트", content: `[배포 가이드](./${target})` },
      { ...by, spaceId: secret.id, slug: target, title: "비공개 점검표", content: `[절차][ref]\n\n[ref]: ${encodeURI(path)}?mode=read#설치` },
      { ...by, spaceId: space.id, slug: "examples", title: "문법 예시", content: [
        `\`[예시](${path})\` [외부](https://other.example${path}) ![그림](${path})`,
        `[이력](${path}/history)\n\n[unused]: ${path}`,
      ].join("\n\n") },
    ] });
    await login(page, "wiki-admin", "admin1234");
    await page.goto(`/s/${space.key}/checklist`);
    await page.locator("article").getByRole("link", { name: "배포 가이드" }).click();
    await expectBacklinks(page, [`${secret.key} · 비공개 점검표`, "출시 체크리스트"]);
    await backlinks(page).filter({ hasText: "출시 체크리스트" }).click();
    await expect(page.getByRole("heading", { name: "출시 체크리스트" })).toBeVisible();

    const view = await reader.newPage();
    await login(view, "bob", "bob1234");
    await view.goto(path);
    await expectBacklinks(view, ["출시 체크리스트"]);

    // 한 원본에서 서로 다른 문법으로 여러 번 걸어도 목록에는 한 번만 나타난다.
    const update = (content: string) => page.request.put(`${api}/checklist`, { data: { title: "출시 체크리스트", content } });
    expect((await update(`[[배포 가이드]] [절차](./${target}#설치)`)).ok()).toBe(true);
    await view.reload();
    await expectBacklinks(view, ["출시 체크리스트"]);
    expect((await update("연결을 제거했습니다.")).ok()).toBe(true);
    await view.reload();
    await expect(backlinks(view)).toHaveCount(0);

    expect((await update("[[배포 가이드]]")).ok()).toBe(true);
    await view.reload();
    await expectBacklinks(view, ["출시 체크리스트"]);
    const created = await page.request.post(api, { data: { title: "회의록", content: "[절차](./배포&#45;가이드)" } });
    expect(created.status()).toBe(201);
    await view.reload();
    await expectBacklinks(view, ["출시 체크리스트", "회의록"]);
    const trash = await page.request.delete(`${api}/${encodeURIComponent("회의록")}`);
    expect(trash.ok()).toBe(true);
    await view.reload();
    await expectBacklinks(view, ["출시 체크리스트"]);
    const { trashId } = await trash.json();
    expect((await page.request.post(`/api/spaces/${space.key}/trash/${trashId}/restore`)).ok()).toBe(true);
    await view.reload();
    await expectBacklinks(view, ["출시 체크리스트", "회의록"]);
  } finally {
    await reader.close();
    await db.space.deleteMany({ where: { id: { in: [space.id, secret.id] } } });
    await db.$disconnect();
  }
});
