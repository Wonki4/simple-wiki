import { prisma } from "./db";
import { getWikiDestinations } from "./wiki-link-destinations";
import { documentUrl, linkedPageSlugs } from "./document-links";

type SpaceRef = { id: string; key: string };

export async function listOrphanPages(space: SpaceRef, readable: SpaceRef[]) {
  const pages = await prisma.page.findMany({
    where: { spaceId: space.id, deletedAt: null },
    select: { slug: true, title: true, updatedAt: true },
    orderBy: [{ title: "asc" }, { slug: "asc" }],
  });
  if (!pages.length) return [];
  const orphans = new Set(pages.map(page => page.slug));
  const targetNames = await getWikiDestinations(space.id);
  const otherSpaces = new Map([[space.key, targetNames]]);
  const namesBySpace = new Map([[space.id, targetNames]]);
  const readableIds = readable.map(s => s.id);

  // 이전 문서와 일반 마크다운 링크는 PageLink 색인만으로 찾을 수 없다.
  // 읽을 수 있는 현재 본문을 묶어서 읽고, 같은 문서를 대상으로 매번 다시 파싱하지 않는다.
  const batchSize = 100;
  let after: string | undefined;
  while (orphans.size) {
    const sources = await prisma.page.findMany({
      where: {
        spaceId: { in: readableIds }, deletedAt: null, id: { gt: after },
        OR: [{ content: { contains: "[" } }, { content: { contains: "/" } }, { content: { contains: "&" } }],
      },
      select: { id: true, slug: true, content: true, space: { select: { id: true, key: true } } },
      orderBy: { id: "asc" }, take: batchSize,
    });
    for (const source of sources) {
      let destinations = namesBySpace.get(source.space.id);
      if (!destinations) {
        destinations = await getWikiDestinations(source.space.id);
        namesBySpace.set(source.space.id, destinations);
      }
      const sourceUrl = documentUrl(source.space.key, source.slug);
      const links = linkedPageSlugs(source.content, sourceUrl, space.key, {
        spaceKey: source.space.key, destinations, otherSpaces,
      });
      for (const slug of links) {
        if (source.space.id !== space.id || slug !== source.slug) orphans.delete(slug);
      }
    }
    if (sources.length < batchSize) break;
    after = sources[sources.length - 1].id;
  }
  return pages.filter(page => orphans.has(page.slug));
}
