import { createHash, randomBytes, randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { expect, test } from "@playwright/test";
import { login } from "./helpers";

const db = new PrismaClient();
test.use({ actionTimeout: 15_000 });
test.afterAll(() => db.$disconnect());

test("과거 회의의 제안·채택·번복을 원문과 연결하고, 월별 변경과 댓글을 해당 스페이스에만 표시한다", async ({ page, request }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page, "bob", "bob1234");
  const bob = await db.user.findUniqueOrThrow({ where: { username: "bob" } });
  const key = `timeline-${randomUUID()}`;
  const owner = randomUUID();
  const title = "운영 회의록";
  const slug = "운영-회의록";
  const proposal = { kind: "discussion", summary: "오류율 기준 제안", evidence: "오류율 2%를 롤백 기준으로 제안했다.", date: "2026-05-08" };
  const decision = { kind: "decision", summary: "오류율 2% 기준 채택", evidence: "오류율 2%에서 롤백하기로 합의했다.", date: "2026-05-10" };
  const reversal = { kind: "decision", summary: "기존 롤백 기준 철회", evidence: "기존 롤백 기준을 철회하기로 했다." };
  const first = `2026년 5월 8일\n${proposal.evidence}`;
  const second = `${first}\n2026-05-10\n${decision.evidence}`;
  const third = second + "\n참석자 확인.";
  const fourth = third + "\n" + reversal.evidence;
  const dates = ["2026-06-01T14:55:00Z", "2026-06-01T15:05:00Z", "2026-06-01T16:10:00Z", "2026-06-03T03:00:00Z"];
  const space = await db.space.create({ data: { key, name: "타임라인 검증", visibility: "restricted" } });
  try {
    await db.user.create({ data: { id: owner, name: key } });
    const grant = await db.spacePermission.create({ data: { spaceId: space.id, subjectType: "user", subjectRef: bob.id, role: "viewer" } });
    await db.spacePermission.create({ data: { spaceId: space.id, subjectType: "user", subjectRef: owner, role: "editor" } });
    async function token(readOnly: boolean) {
      const raw = "swk_" + randomBytes(32).toString("base64url");
      await db.apiToken.create({ data: {
        userId: owner, spaceId: space.id, readOnly, name: "타임라인 테스트", prefix: raw.slice(0, 12),
        tokenHash: createHash("sha256").update(raw).digest("hex"),
      } });
      return { Authorization: `Bearer ${raw}` };
    }
    const write = await token(false);
    const read = await token(true);
    const doc = await db.page.create({ data: {
      spaceId: space.id, title, slug, content: fourth, version: 4, createdById: owner, updatedById: owner,
      revisions: { create: [first, second, third, fourth].map((content, i) => ({
        title, version: i + 1, content, authorId: owner, createdAt: new Date(dates[i]),
      })) },
    } });
    const comments = ["수치를 확인했습니다.", "후속 측정을 준비하겠습니다."];
    for (const [i, body] of comments.entries()) {
      await db.comment.create({ data: { pageId: doc.id, authorId: bob.id, body, createdAt: new Date(Date.parse(dates[2]) + i * 1000) } });
    }
    const api = `/api/spaces/${key}`;
    const endpoint = `${api}/pages/${encodeURIComponent(slug)}/timeline`;
    const sources = `${api}/timeline/sources?from=2026-06-01&to=2026-06-03&limit=2`;
    const sourcesPage = async (cursor = "") => {
      const result = await request.get(sources + (cursor ? "&cursor=" + encodeURIComponent(cursor) : ""), { headers: read });
      expect(result.status()).toBe(200);
      return result.json();
    };
    const save = (version: number, entries: unknown[]) => request.put(endpoint, { headers: write, data: { version, entries } });
    expect((await request.get(sources)).status()).toBe(401);
    expect((await request.get(sources.replace(key, "eng"), { headers: read })).status()).toBe(404);
    expect((await request.put(endpoint, { headers: read, data: { version: 1, entries: [] } })).status()).toBe(403);
    const batch = await sourcesPage();
    expect(batch.sources.map((row: { version: number }) => row.version)).toEqual([1, 2]);
    expect(batch.sources[0]).not.toHaveProperty("content");
    const past = await request.get(`${api}/pages/${encodeURIComponent(slug)}?version=1`, { headers: read });
    expect((await past.json()).content).toBe(first);
    expect((await save(1, [proposal])).status()).toBe(200);
    expect((await save(3, [decision])).status()).toBe(200);
    expect((await save(2, [decision])).status()).toBe(200);
    expect((await save(2, [decision])).status()).toBe(200);
    expect((await save(2, [{ ...decision, evidence: reversal.evidence }])).ok()).toBe(false);
    expect((await save(2, [{ ...decision, date: "2026-04-01" }])).ok()).toBe(false);
    expect((await sourcesPage(batch.nextCursor)).sources.map((row: { version: number }) => row.version)).toEqual([4]);
    expect((await save(4, [])).status()).toBe(200);
    expect((await sourcesPage()).sources).toEqual([]);
    expect((await save(4, [reversal])).status()).toBe(200);

    const spacePath = `/s/${key}`;
    const docPath = `${spacePath}/${encodeURIComponent(slug)}`;
    const timeline = `${spacePath}/-/timeline`;
    await page.goto(spacePath);
    await page.getByRole("link", { name: "타임라인", exact: true }).click();
    await expect(page.getByRole("heading", { name: "스페이스 타임라인" })).toBeVisible();
    for (const period of ["1개월", "3개월", "6개월", "1년", "3년", "사용자 지정"]) {
      await expect(page.getByText(period, { exact: true }).first()).toBeVisible();
    }
    const custom = `${timeline}?period=custom&from=2026-05-01&to=2026-06-03`;
    await page.getByRole("link", { name: "사용자 지정" }).click();
    await page.getByLabel("시작일").fill("2026-05-01");
    await page.getByLabel("종료일").fill("2026-06-03");
    await page.getByRole("button", { name: "기간 적용" }).click();
    await expect(page).toHaveURL(custom);
    await expect(page.getByRole("link", { name: "3년", exact: true })).toHaveAttribute("href", `${timeline}?period=3y&to=2026-06-03`);
    await page.context().grantPermissions(["clipboard-read", "clipboard-write"], { origin: new URL(page.url()).origin });
    await page.getByRole("button", { name: "기간 정리 요청 복사" }).click();
    await expect(page.getByRole("status").filter({ hasText: "복사했습니다" })).toBeVisible();
    const prompt = await page.evaluate(() => navigator.clipboard.readText());
    for (const field of [key, "2026-05-01", "2026-06-03", "list_timeline_sources", "get_page", "save_page_timeline"]) {
      expect(prompt).toContain(field);
    }
    await expect(page.getByText(decision.summary, { exact: true })).toHaveCount(1);
    await expect(page.getByText(reversal.summary, { exact: true }).first()).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
    await page.getByRole("link", { name: "2026년 5월 전체 기록 보기" }).click();
    await expect(page.getByRole("link", { name: "2026년 5월 전체 기록 접기" })).toBeVisible();
    await expect(page.getByText(proposal.summary, { exact: true }).first()).toBeVisible();
    const original = page.locator(`a[href="${docPath}/history/2"]`).first();
    // Evidence is disclosed along with the original revision when an entry is opened.
    if (!(await original.isVisible())) await page.getByText(decision.summary, { exact: true }).first().click();
    await expect(page.getByText(decision.evidence, { exact: true }).first()).toBeVisible();
    await original.click();
    await expect(page).toHaveURL(new RegExp("/history/2$"));
    await expect(page.getByText(decision.evidence, { exact: false }).first()).toBeVisible();
    await page.goto(custom);
    await page.getByRole("link", { name: "2026년 6월 전체 기록 보기" }).click();
    const juneExpanded = page.getByRole("link", { name: "2026년 6월 전체 기록 접기" });
    await expect(juneExpanded).toBeVisible();
    await expect(page.getByText("기록일 기준", { exact: false }).first()).toBeVisible();
    const compare = page.locator('a[href*="from=1"][href*="to=3"]').first();
    await compare.click();
    await expect(page).toHaveURL(/history\?from=1&to=3/);
    await page.goBack();
    await expect(juneExpanded).toBeVisible();
    const comment = page.locator('a[href*="#comment-"]').first();
    await comment.click();
    await expect(page.locator(":target")).toContainText(/수치|후속/);
    await db.page.update({ where: { id: doc.id }, data: { deletedAt: new Date() } });
    await page.goto(custom);
    await expect(page.getByText(decision.summary, { exact: true })).toHaveCount(0);
    expect((await save(2, [decision])).status()).toBe(404);
    await db.spacePermission.delete({ where: { id: grant.id } });
    await page.reload();
    await expect(page.getByRole("heading", { name: "페이지를 찾을 수 없습니다" })).toBeVisible();
  } finally {
    await db.space.delete({ where: { id: space.id } });
    await db.user.deleteMany({ where: { id: owner } });
  }
});
