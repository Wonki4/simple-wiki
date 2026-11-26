import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { expect, test } from "@playwright/test";
import { login } from "./helpers";

test("접힌 스페이스도 이름으로 찾고 모바일 검색 결과에서 이동한다", async ({ page }) => {
  const db = new PrismaClient();
  const id = randomUUID().slice(0, 8);
  const sharedName = `Atlas${id}`;
  const publicSpace = { key: `nav-public-${id}`, name: `${sharedName} 안내`, visibility: "organization" } as const;
  const privateSpace = { key: `nav-private-${id}`, name: `${sharedName} 회의`, visibility: "restricted" } as const;
  try {
    await db.space.createMany({ data: [publicSpace, privateSpace] });
    await login(page, "wiki-admin", "admin1234");
    const sidebar = page.getByRole("complementary", { name: "위키 탐색" });
    const search = sidebar.getByRole("searchbox", { name: "스페이스 이름 검색" });
    const publicGroup = sidebar.getByRole("group", { name: "전체 공개", exact: true });
    const privateGroup = sidebar.getByRole("group", { name: "비공개", exact: true });
    const publicToggle = publicGroup.getByRole("button", { name: "전체 공개", exact: true });
    const privateToggle = privateGroup.getByRole("button", { name: "비공개", exact: true });
    const publicLink = publicGroup.getByRole("link", { name: publicSpace.name });
    const privateLink = privateGroup.getByRole("link", { name: privateSpace.name });

    await expect(publicToggle).toHaveAttribute("aria-expanded", "true");
    await expect(privateToggle).toHaveAttribute("aria-expanded", "true");
    await privateToggle.click();
    await expect(privateLink).toBeHidden();
    await expect(publicLink).toBeVisible();
    await page.reload();
    await expect(privateToggle).toHaveAttribute("aria-expanded", "false");
    await search.fill(`  ${sharedName.toUpperCase()}  `);
    await expect(privateToggle).toHaveAttribute("aria-expanded", "true");
    await expect(privateLink).toBeVisible();
    await expect(publicLink).toBeVisible();
    await expect(publicGroup.getByRole("link")).toHaveCount(1);
    await expect(privateGroup.getByRole("link")).toHaveCount(1);
    await publicToggle.click();
    await expect(publicLink).toBeHidden();
    await expect(privateLink).toBeVisible();

    await search.fill(privateSpace.key);
    await expect(sidebar.getByText("일치하는 스페이스가 없습니다.", { exact: true })).toBeVisible();
    await sidebar.getByRole("button", { name: "스페이스 검색 지우기" }).click();
    await expect(search).toBeFocused();
    await expect(privateToggle).toHaveAttribute("aria-expanded", "false");
    await expect(publicToggle).toHaveAttribute("aria-expanded", "true");
    await privateToggle.click();
    await expect(privateLink).toBeVisible();
    await publicToggle.click();
    await expect(publicLink).toBeHidden();
    await expect(privateLink).toBeVisible();

    await page.setViewportSize({ width: 390, height: 844 });
    const openNavigation = page.getByRole("button", { name: "위키 탐색 열기" });
    await expect(sidebar).toBeHidden();
    await openNavigation.click();
    await sidebar.getByRole("button", { name: "탐색 닫기" }).click();
    await expect(sidebar).toBeHidden();
    await openNavigation.click();
    await search.fill(privateSpace.name);
    await privateLink.click();
    await expect(page).toHaveURL(new RegExp(`/s/${privateSpace.key}$`));
    await expect(page.getByRole("heading", { name: privateSpace.name, exact: true })).toBeVisible();
    await expect(sidebar).toBeHidden();
  } finally {
    await db.space.deleteMany({ where: { key: { in: [publicSpace.key, privateSpace.key] } } });
    await db.$disconnect();
  }
});
