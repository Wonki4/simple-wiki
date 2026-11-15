import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import remarkRehype from "remark-rehype";
import { visit } from "unist-util-visit";
import { prisma } from "./db";
import { getWikiDestinations } from "./wiki-link-destinations";
import { remarkWikiLinks, type WikiLinkOptions } from "./wiki-links";

const parser = unified().use(remarkParse).use(remarkGfm);
const toHtml = unified().use(remarkRehype);

export function linkedPageSlugs(content: string, source: URL, targetSpaceKey: string, options: WikiLinkOptions) {
  const tree = parser.parse(content);
  remarkWikiLinks(options)(tree);
  const linked = new Set<string>();
  visit(toHtml.runSync(tree), "element", node => {
    if (node.tagName !== "a" || typeof node.properties.href !== "string") return;
    const url = URL.parse(node.properties.href, source);
    if (url?.origin !== source.origin) return;
    const match = /^\/s\/([^/]+)\/([^/]+)\/?$/.exec(url.pathname);
    if (!match) return;
    try {
      const slug = decodeURIComponent(match[2]);
      if (decodeURIComponent(match[1]) === targetSpaceKey && slug !== "new" && slug !== "settings") linked.add(slug);
    } catch {
      // 잘못 인코딩된 주소 하나가 나머지 문서의 검사를 막지 않도록 한다.
    }
  });
  return linked;
}

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
  const origin = process.env.AUTH_URL ?? "http://localhost:3000";

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
      const sourceUrl = new URL(`/s/${source.space.key}/${encodeURIComponent(source.slug)}`, origin);
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
