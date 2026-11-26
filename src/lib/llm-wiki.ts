import { prisma } from "./db";
import { validWikiKey } from "./llm-wiki-input";

export async function listWikiTopics(spaceId: string, { q = "", sourceSlug, offset = 0, limit = 30 }:
  { q?: string; sourceSlug?: string; offset?: number; limit?: number } = {}) {
  const visible = { revision: { page: { spaceId, deletedAt: null } } };
  const matchingSource = sourceSlug ? { revision: { page: { spaceId, slug: sourceSlug, deletedAt: null } } } : visible;
  const search = q.trim().normalize("NFC").replace(/[\\%_]/g, "\\$&");
  const rows = await prisma.wikiTopic.findMany({
    where: { spaceId, items: { some: matchingSource }, ...(search && { OR: [
      { title: { contains: search, mode: "insensitive" } }, { key: { contains: search, mode: "insensitive" } },
    ] }) },
    orderBy: [{ updatedAt: "desc" }, { key: "asc" }], skip: offset, take: limit + 1,
    select: { key: true, title: true, version: true, updatedAt: true, _count: { select: { items: { where: visible } } } },
  });
  return {
    topics: rows.slice(0, limit).map(({ updatedAt, _count, ...topic }) => ({
      ...topic, updatedAt: updatedAt.toISOString(), itemCount: _count.items,
    })),
    nextOffset: rows.length > limit ? offset + limit : null,
  };
}

export async function getWikiTopic(spaceId: string, rawKey: string) {
  const key = validWikiKey(rawKey);
  if (!key) return null;
  const topic = await prisma.wikiTopic.findUnique({
    where: { spaceId_key: { spaceId, key } },
    select: {
      key: true, title: true, version: true, updatedAt: true,
      items: { where: { revision: { page: { spaceId, deletedAt: null } } }, orderBy: { key: "asc" }, select: {
        key: true, kind: true, text: true, evidence: true,
        revision: { select: { pageId: true, version: true, title: true, page: { select: { slug: true } } } },
      } },
    },
  });
  if (!topic || !topic.items.length) return null;
  return { key: topic.key, title: topic.title, version: topic.version, updatedAt: topic.updatedAt.toISOString(),
    items: topic.items.map(({ revision, evidence, ...item }) => ({
      ...item, source: { pageId: revision.pageId, slug: revision.page.slug, title: revision.title, version: revision.version, evidence },
    })),
  };
}
