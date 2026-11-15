import { unstable_cache, revalidateTag } from "next/cache";
import { prisma } from "./db";
import { documentUrl, linkedPageSlugs } from "./document-links";
import { slugify } from "./slug";
import { extractWikiLinks } from "./wiki-links";

// 안정된 URL > 현재 제목 > 과거 제목. 같은 우선순위에 문서가 두 개면 주소를 임의로 고르지 않는다.
export function resolveWikiNames(names: { name: string; slug: string; priority: number }[]): Map<string, string> {
  const choices = new Map<string, { slug: string | null; priority: number }>();
  for (const { name, slug, priority } of names) {
    const key = slugify(name);
    if (!key) continue;
    const choice = choices.get(key);
    if (!choice || priority < choice.priority) choices.set(key, { slug, priority });
    else if (priority === choice.priority && slug !== choice.slug) choice.slug = null;
  }
  const resolved = new Map<string, string>();
  for (const [key, choice] of choices) if (choice.slug) resolved.set(key, choice.slug);
  return resolved;
}

export function spaceLinksTag(spaceId: string) {
  return `wiki-names:${spaceId}`;
}

export function invalidateWikiNames(spaceId: string) {
  revalidateTag(spaceLinksTag(spaceId));
}

export async function getWikiDestinations(spaceId: string) {
  const entries = await unstable_cache(async () => {
    // DB에서 제목만 중복 제거한다. 배포 전의 이름 변경도 별도 이관 없이 해석한다.
    const names = await prisma.$queryRaw<{ name: string; slug: string; priority: number }[]>`
      SELECT slug AS name, slug, 0 AS priority FROM "Page" WHERE "deletedAt" IS NULL AND "spaceId" = ${spaceId}
      UNION ALL
      SELECT title, slug, 1 FROM "Page" WHERE "deletedAt" IS NULL AND "spaceId" = ${spaceId}
      UNION ALL
      SELECT DISTINCT r.title, p.slug, 2 FROM "PageRevision" r
      JOIN "Page" p ON r."pageId" = p.id
      WHERE p."deletedAt" IS NULL AND p."spaceId" = ${spaceId} AND r.title <> p.title
    `;
    return [...resolveWikiNames(names)];
  }, ["wiki-destinations-v1", spaceId], { tags: [spaceLinksTag(spaceId)], revalidate: 60 })();
  return new Map(entries);
}

type LinkSpace = { key: string; id: string };

export async function wikiLinkOptions(space: LinkSpace, others: LinkSpace[]) {
  const [destinations, entries] = await Promise.all([
    getWikiDestinations(space.id),
    Promise.all(others.map(async s => [s.key, await getWikiDestinations(s.id)] as const)),
  ]);
  return { spaceKey: space.key, destinations, otherSpaces: new Map(entries) };
}

export function linkedSpaces(content: string, currentKey: string, readable: LinkSpace[]) {
  const keys = new Set(extractWikiLinks(content).map(link => link.space));
  return readable.filter(s => s.key !== currentKey && keys.has(s.key));
}

const backlinksTag = "document-backlinks";

export function invalidateBacklinks() {
  revalidateTag(backlinksTag);
}

const findBacklinks = unstable_cache(async (space: LinkSpace, slug: string, readableIds: string[]) => {
  const destinations = await getWikiDestinations(space.id);
  const keys = [...destinations].filter(([, target]) => target === slug).map(([key]) => key);
  const candidates = await prisma.page.findMany({
    where: {
      spaceId: { in: readableIds }, deletedAt: null,
      NOT: { spaceId: space.id, slug },
      OR: [
        { linksFrom: { some: { toSpaceId: space.id, toSlug: { in: keys } } } },
        // Also find links written before scoped targets and sections were indexed.
        { content: { contains: `${space.key}:` } },
        { spaceId: space.id, AND: [{ content: { contains: "[[" } }, { content: { contains: "#" } }] },
        // 일반 링크는 PageLink 색인이 없다. URL에 slug가 그대로 있거나 일부 문자가
        // 퍼센트 인코딩, HTML 문자 참조, 이스케이프된 하이픈으로 적힌 본문만 후보로 둔다.
        { AND: [
          { OR: [{ content: { contains: "[" } }, { content: { contains: "/" } }] },
          { OR: [
            { content: { contains: slug } }, { content: { contains: "\\%" } },
            { content: { contains: "&" } }, { content: { contains: "\\\\-" } },
          ] },
        ] },
      ],
    },
    select: { slug: true, title: true, content: true, space: { select: { key: true, id: true } } },
    orderBy: [{ title: "asc" }, { slug: "asc" }],
  });
  const localNames = new Map([[space.id, destinations]]);
  const sources = new Map(candidates.map(page => [page.space.id, page.space]));
  await Promise.all([...sources.values()].filter(s => s.id !== space.id).map(async s => {
    localNames.set(s.id, await getWikiDestinations(s.id));
  }));
  const otherSpaces = new Map([[space.key, destinations]]);
  const matches = candidates.filter(page => {
    const source = documentUrl(page.space.key, page.slug);
    const options = { spaceKey: page.space.key, destinations: localNames.get(page.space.id)!, otherSpaces };
    return linkedPageSlugs(page.content, source, space.key, options).has(slug);
  });
  return matches.map(page => ({ title: page.title, slug: page.slug, spaceKey: page.space.key }));
}, ["document-backlinks-v1"], { tags: [backlinksTag], revalidate: 60 });

export function getBacklinks(space: LinkSpace, slug: string, readable: LinkSpace[]) {
  return findBacklinks({ id: space.id, key: space.key }, slug, readable.map(s => s.id).sort());
}
