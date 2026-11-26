import { createHash } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { prisma } from "./db";
import { JsonInputError } from "./bounded-json";
import type { WikiTopicPatch, WikiWriteInput } from "./llm-wiki-input";

function byKey(a: { key: string }, b: { key: string }) {
  return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
}

type Source = { id: string; version: number; createdAt: Date };

export class WikiTopicConflict extends JsonInputError {
  constructor(readonly topicKey: string, readonly currentVersion: number) {
    super(`주제 '${topicKey}'의 현재 버전은 v${currentVersion}입니다. 내용을 다시 확인하세요.`, 409);
  }
}

async function applyPatch(tx: Prisma.TransactionClient, spaceId: string, source: Source,
  latestSourceVersion: number, patch: WikiTopicPatch) {
  const { key, title, expectedVersion } = patch;
  if (expectedVersion === 0) {
    await tx.wikiTopic.createMany({ data: [{ spaceId, key, title }], skipDuplicates: true });
  }
  const [topic] = await tx.$queryRaw<{ id: string; version: number }[]>`
    SELECT id, version FROM "WikiTopic" WHERE "spaceId" = ${spaceId} AND key = ${key} FOR UPDATE
  `;
  if (!topic) throw new WikiTopicConflict(key, 0);

  const changes = [...patch.changes].sort(byKey);
  const digest = createHash("sha256").update(JSON.stringify([title, changes])).digest("hex");
  const previous = await tx.wikiTopicUpdate.findUnique({
    where: { topicId_revisionId_digest: { topicId: topic.id, revisionId: source.id, digest } }, select: { version: true },
  });
  if (previous) return previous.version;
  if (source.version !== latestSourceVersion) {
    throw new JsonInputError(`원문 최신 버전 v${latestSourceVersion}을 다시 읽고 주제를 갱신하세요.`, 409);
  }
  if (expectedVersion !== topic.version) throw new WikiTopicConflict(key, topic.version);

  const touched = { topicId: topic.id, key: { in: changes.map(change => change.key) } };
  const newer = await tx.wikiTopicItem.findFirst({
    where: { ...touched, revision: { createdAt: { gt: source.createdAt } } }, select: { key: true },
  });
  if (newer) throw new JsonInputError(`'${key}/${newer.key}'에 더 최근 원문이 연결되어 있습니다. 근거를 다시 확인하세요.`, 409);

  const version = topic.version + 1;
  await tx.wikiTopicItem.deleteMany({ where: touched });
  await tx.wikiTopicItem.createMany({ data: changes.map(change => ({ ...change, topicId: topic.id, revisionId: source.id })) });
  await tx.wikiTopic.update({ where: { id: topic.id }, data: { title, version } });
  await tx.wikiTopicUpdate.create({ data: { topicId: topic.id, version, revisionId: source.id, digest } });
  return version;
}

export async function saveWikiTopics(spaceId: string, slug: string, { pageId, version, topics }: WikiWriteInput) {
  return prisma.$transaction(async tx => {
    const [page] = await tx.$queryRaw<{ id: string; version: number }[]>`
      SELECT id, version FROM "Page" WHERE "spaceId" = ${spaceId} AND slug = ${slug} AND "deletedAt" IS NULL FOR UPDATE
    `;
    if (!page) return null;
    if (pageId !== undefined && page.id !== pageId) throw new JsonInputError("원문 주소가 다른 문서를 가리킵니다. 저장한 문서를 다시 확인하세요.", 409);
    const revision = await tx.pageRevision.findUnique({
      where: { pageId_version: { pageId: page.id, version } },
      select: { id: true, version: true, content: true, createdAt: true },
    });
    if (!revision) return null;
    const versions = new Map<string, number>();
    // Take topic locks in the same order for requests from different source documents.
    for (const patch of [...topics].sort(byKey)) {
      for (const change of patch.changes) {
        if (!revision.content.includes(change.evidence)) throw new JsonInputError(`'${patch.key}/${change.key}'의 근거 문장이 해당 버전의 원문과 일치하지 않습니다.`);
      }
      versions.set(patch.key, await applyPatch(tx, spaceId, revision, page.version, patch));
    }
    return { version, topics: topics.map(({ key }) => ({ key, version: versions.get(key)! })) };
  }, { timeout: 15000 });
}
