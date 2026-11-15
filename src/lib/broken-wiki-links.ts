import { prisma } from "./db";
import { sectionId } from "./slug";
import { wikiLinkOptions } from "./wiki-link-destinations";
import { extractWikiLinks, resolveWikiLink } from "./wiki-links";
import { wikiSections } from "./wiki-sections";

type SpaceRef = { id: string; key: string };
type Issue =
  | { target: string; spaceKey: string; missing: "page"; title: string }
  | { target: string; spaceKey: string; missing: "section"; slug: string };

export async function listBrokenWikiLinks(space: SpaceRef, readable: SpaceRef[]) {
  // 색인에 없는 이전 문서, 현재 문서의 소제목, 마크다운 문자 참조(&#91;)도 검사한다.
  const pages = await prisma.page.findMany({
    where: { spaceId: space.id, deletedAt: null, OR: [{ content: { contains: "[" } }, { content: { contains: "&" } }] },
    select: { title: true, slug: true, content: true },
    orderBy: [{ title: "asc" }, { slug: "asc" }],
  });
  const sources = pages.map(({ slug, title, content }) => ({ slug, title, links: extractWikiLinks(content) }))
    .filter(source => source.links.length);
  if (!sources.length) return [];
  const scopes = new Set(sources.flatMap(source => source.links.map(link => link.space)));
  const others = readable.filter(s => s.key !== space.key && scopes.has(s.key));
  const names = await wikiLinkOptions(space, others);

  // 소제목이 참조된 문서만 묶어서 읽고, 같은 문서의 목차는 한 번만 만든다.
  const sectionTargets = new Map<string, Set<string>>();
  const resolved = sources.map(({ links, ...source }) => ({
    ...source,
    links: links.map(link => {
      const dest = resolveWikiLink(link, names);
      if (dest?.kind === "page" && dest.section) {
        const slugs = sectionTargets.get(dest.spaceKey) ?? new Set<string>();
        slugs.add(dest.slug || source.slug);
        sectionTargets.set(dest.spaceKey, slugs);
      }
      return { target: link.target, dest };
    }),
  }));

  const where = [space, ...others].flatMap(s => {
    const slugs = sectionTargets.get(s.key);
    return slugs ? [{ spaceId: s.id, slug: { in: [...slugs] } }] : [];
  });
  const targets = where.length ? await prisma.page.findMany({
    where: { deletedAt: null, OR: where }, select: { space: { select: { key: true } }, slug: true, content: true },
  }) : [];
  const sections = new Map(targets.map(p => [
    `${p.space.key}/${p.slug}`, new Set(wikiSections(p.content).map(section => section.id)),
  ]));

  return resolved.flatMap(({ slug, title, links }) => {
    const issues: Issue[] = [];
    for (const { target, dest } of links) {
      if (!dest) continue;
      if (dest.kind === "missing") {
        issues.push({ target, spaceKey: dest.spaceKey, missing: "page", title: dest.title });
      } else if (dest.section) {
        const destination = dest.slug || slug;
        if (!sections.get(`${dest.spaceKey}/${destination}`)?.has(sectionId(dest.section))) {
          issues.push({ target, spaceKey: dest.spaceKey, missing: "section", slug: destination });
        }
      }
    }
    return issues.length ? [{ slug, title, issues }] : [];
  });
}
