import { createHash, randomBytes, randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { expect, test } from "@playwright/test";
import { login } from "./helpers";

test("회의 제안이 기준으로 확정되면 해당 주제만 바뀌고 근거는 정확한 원문 버전으로 열린다", async ({ page, request }) => {
  const db = new PrismaClient();
  const key = `topics-${randomUUID()}`;
  const editorId = randomUUID();
  const space = await db.space.create({ data: { key, name: "운영 기준", visibility: "restricted" } });
  const home = `/s/${key}`;
  const api = `/api/spaces/${key}`;
  try {
    await login(page, "bob", "bob1234");
    const bob = await db.user.findUniqueOrThrow({ where: { username: "bob" } });
    await db.user.create({ data: { id: editorId, name: "운영 문서 에이전트" } });
    await db.spacePermission.createMany({ data: [
      { spaceId: space.id, subjectType: "user", subjectRef: editorId, role: "editor" },
      { spaceId: space.id, subjectType: "user", subjectRef: bob.id, role: "viewer" },
    ] });
    async function issueToken(readOnly: boolean) {
      const token = "swk_" + randomBytes(32).toString("base64url");
      await db.apiToken.create({ data: {
        userId: editorId, spaceId: space.id, name: "LLM Wiki 테스트", readOnly,
        tokenHash: createHash("sha256").update(token).digest("hex"), prefix: token.slice(0, 12),
      } });
      return { Authorization: `Bearer ${token}` };
    }
    const write = await issueToken(false);
    const read = await issueToken(true);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(home);
    await page.getByRole("link", { name: "LLM Wiki", exact: true }).click();
    await expect(page.getByText("아직 정리된 주제가 없습니다.")).toBeVisible();

    const title = "운영 회의록";
    const proposal = "오류율 2%를 롤백 기준으로 제안했다.";
    const decision = "오류율 2%를 넘으면 롤백하기로 결정했다.";
    const onCall = "야간에는 당직자에게 연락한다.";
    const doc = await request.post(`${api}/pages`, { headers: write, data: { title, content: `${proposal}\n\n${onCall}` } });
    expect(doc.status()).toBe(201);
    const { slug, pageId } = await doc.json();
    expect(typeof pageId).toBe("string");
    const source = `${api}/pages/${encodeURIComponent(slug)}`;
    const save = (version: number, topics: object[]) => request.put(`${source}/llm-wiki`, { headers: write, data: { pageId, version, topics } });
    const rollout = { key: "배포-롤백", title: "배포와 롤백", expectedVersion: 0, changes: [
      { key: "limit", kind: "discussion", text: "롤백 기준 2% 제안", evidence: proposal },
      { key: "night", kind: "example", text: "야간 운영 연락 절차", evidence: onCall },
    ] };
    const topicUrl = `${api}/llm-wiki/${encodeURIComponent(rollout.key)}`;
    const contacts = { key: "후속-연락망", title: "연락망", expectedVersion: 0, changes: [
      { key: "night", kind: "current", text: "야간 연락처는 당직자다.", evidence: onCall },
    ] };
    expect((await save(1, [rollout, contacts])).ok()).toBe(true);
    expect((await save(1, [rollout, contacts])).ok()).toBe(true);
    await page.reload();
    await page.getByRole("link", { name: rollout.title }).click();
    await expect(page.getByRole("heading", { name: "논의 중" })).toBeVisible();
    await expect(page.getByText(rollout.changes[0].text, { exact: true })).toBeVisible();
    const contactsUrl = `${api}/llm-wiki/${encodeURIComponent(contacts.key)}`;
    const untouched = await (await request.get(contactsUrl, { headers: read })).json();
    const update = await request.put(source, { headers: write, data: { title, content: decision, expectedVersion: 1 } });
    expect(update.ok()).toBe(true);
    const accepted = { ...rollout, expectedVersion: 1, changes: [
      { key: "limit", kind: "current", text: "오류율 2% 초과 시 롤백", evidence: decision },
    ] };
    const invalid = { ...contacts, expectedVersion: 1, changes: [{ ...contacts.changes[0], evidence: "없는 문장" }] };
    expect((await save(2, [accepted, invalid])).ok()).toBe(false);
    expect((await (await request.get(topicUrl, { headers: read })).json()).version).toBe(1);
    expect((await save(2, [accepted])).ok()).toBe(true);
    expect((await save(2, [accepted])).ok()).toBe(true);
    expect((await save(2, [])).ok()).toBe(true);
    expect((await save(1, [rollout])).ok()).toBe(true);
    expect((await save(1, [{ ...rollout, expectedVersion: 2, title: "이전 제안" }])).status()).toBe(409);
    const acceptedTopic = await (await request.get(topicUrl, { headers: read })).json();
    expect(acceptedTopic).toMatchObject({ version: 2, items: [
      { key: "limit", kind: "current", source: { pageId, version: 2, evidence: decision } },
      { key: "night", kind: "example", source: { pageId, version: 1, evidence: onCall } },
    ] });
    expect(await (await request.get(contactsUrl, { headers: read })).json()).toEqual(untouched);
    expect((await request.get(`${api}/llm-wiki`)).status()).toBe(401);
    expect((await request.get("/api/spaces/notice/llm-wiki", { headers: read })).status()).toBe(404);
    expect((await request.put(`${source}/llm-wiki`, { headers: read, data: { version: 2, topics: [] } })).status()).toBe(403);
    expect((await page.request.put(`${source}/llm-wiki`, { data: { version: 2, topics: [] } })).status()).toBe(403);

    expect((await request.put(source, { headers: write, data: { title, content: "별도 안건을 기록했다.", expectedVersion: 2 } })).ok()).toBe(true);
    await page.reload();
    await expect(page.getByRole("heading", { name: "현재 기준" })).toBeVisible();
    await expect(page.getByText(rollout.changes[0].text, { exact: true })).toHaveCount(0);
    await page.getByRole("region", { name: "현재 기준" }).getByText("근거 문장", { exact: true }).click();
    await expect(page.getByText(decision, { exact: true })).toBeVisible();
    const citation = page.getByRole("link", { name: `${title} v2` });
    const v1Permalink = `${home}/${encodeURIComponent(slug)}/history/1?pageId=${encodeURIComponent(pageId)}`;
    await expect(page.getByRole("link", { name: `${title} v1` })).toHaveAttribute("href", v1Permalink);
    await expect(citation).toHaveAttribute("href", `${home}/${encodeURIComponent(slug)}/history/2?pageId=${encodeURIComponent(pageId)}`);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
    await citation.click();
    await expect(page.getByRole("heading", { name: title, exact: true })).toBeVisible();
    await expect(page.locator("article")).toContainText(decision);

    expect((await request.delete(source, { headers: write })).ok()).toBe(true);
    expect((await request.get(topicUrl, { headers: read })).status()).toBe(404);
    await page.goto(`${home}/-/llm-wiki`);
    await expect(page.getByText("아직 정리된 주제가 없습니다.")).toBeVisible();

    // The same URL/version may now belong to another page. A retry pinned to the old ID must fail.
    const replacement = await request.post(`${api}/pages`, { headers: write, data: { title, content: decision } });
    expect(replacement.status()).toBe(201);
    const replacementId = (await replacement.json()).pageId;
    expect(replacementId).not.toBe(pageId);
    await page.goto(v1Permalink);
    await expect(page.getByRole("heading", { name: "페이지를 찾을 수 없습니다" })).toBeVisible();
    await page.goto(`${home}/${encodeURIComponent(slug)}/history/1`);
    await expect(page.locator("article")).toContainText(decision);
    const recreate = { ...accepted, expectedVersion: 0 };
    expect((await save(1, [recreate])).status()).toBe(409);
    const apply = (url: string, id: string, patch: object) => request.put(`${url}/llm-wiki`, {
      headers: write, data: { pageId: id, version: 1, topics: [patch] },
    });
    const conflict = await apply(source, replacementId, recreate);
    expect(conflict.status()).toBe(409);
    const { currentVersion } = await conflict.json();
    expect(currentVersion).toBe(2);
    expect((await apply(source, replacementId, { ...recreate, expectedVersion: currentVersion })).ok()).toBe(true);
    expect((await (await request.get(topicUrl, { headers: read })).json()).items).toHaveLength(1);

    // Different source documents can write concurrently. Merging the losing edit must keep both claims.
    const retrospective = await request.post(`${api}/pages`, { headers: write, data: { title: "배포 회고", content: onCall } });
    expect(retrospective.status()).toBe(201);
    const other = await retrospective.json();
    const otherSource = `${api}/pages/${encodeURIComponent(other.slug)}`;
    const edits = [
      { url: source, id: replacementId, change: { ...accepted.changes[0], key: "monitor" } },
      { url: otherSource, id: other.pageId, change: { ...contacts.changes[0], key: "on-call" } },
    ];
    const responses = await Promise.all(edits.map(edit =>
      apply(edit.url, edit.id, { ...accepted, expectedVersion: 3, changes: [edit.change] })));
    expect(responses.map(response => response.status()).sort()).toEqual([200, 409]);
    const loser = edits[responses.findIndex(response => response.status() === 409)];
    expect((await apply(loser.url, loser.id, { ...accepted, expectedVersion: 4, changes: [loser.change] })).ok()).toBe(true);
    const related = await request.get(`${api}/llm-wiki`, { headers: read, params: { sourceSlug: other.slug } });
    expect(await related.json()).toMatchObject({ topics: [{ key: rollout.key, itemCount: 3, version: 5 }] });
    const stale = { ...accepted, expectedVersion: 5, changes: [{ ...accepted.changes[0], key: "on-call" }] };
    expect((await apply(source, replacementId, stale)).status()).toBe(409);
  } finally {
    await db.space.delete({ where: { id: space.id } });
    await db.user.deleteMany({ where: { id: editorId } });
    await db.$disconnect();
  }
});
