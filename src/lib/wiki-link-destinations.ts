import { unstable_cache, revalidateTag } from "next/cache";
import { prisma } from "./db";
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
      SELECT slug AS name, slug, 0 AS priority FROM "Page" WHERE "spaceId" = ${spaceId}
      UNION ALL
      SELECT title, slug, 1 FROM "Page" WHERE "spaceId" = ${spaceId}
      UNION ALL
      SELECT DISTINCT r.title, p.slug, 2 FROM "PageRevision" r
      JOIN "Page" p ON r."pageId" = p.id
      WHERE p."spaceId" = ${spaceId} AND r.title <> p.title
    `;
    return [...resolveWikiNames(names)];
  }, ["wiki-destinations-v1", spaceId], { tags: [spaceLinksTag(spaceId)], revalidate: 60 })();
  return new Map(entries);
}

export async function getBacklinks(spaceId: string, slug: string) {
  const destinations = await getWikiDestinations(spaceId);
  const keys = [...destinations].filter(([, target]) => target === slug).map(([key]) => key);
  const candidates = await prisma.page.findMany({
    where: { spaceId, linksFrom: { some: { toSpaceId: spaceId, toSlug: { in: keys } } } },
    select: { slug: true, title: true, content: true },
    orderBy: { title: "asc" },
  });
  // 기존 색인에는 코드 예시도 들어 있다. 다시 저장하기 전에도 잘못된 백링크를 노출하지 않는다.
  return candidates
    .filter(page => extractWikiLinks(page.content).some(link => destinations.get(link.slug) === slug))
    .map(({ title, slug }) => ({ title, slug }));
}
