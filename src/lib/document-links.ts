import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import remarkRehype from "remark-rehype";
import { visit } from "unist-util-visit";
import { remarkWikiLinks, type WikiLinkOptions } from "./wiki-links";

const parser = unified().use(remarkParse).use(remarkGfm);
const toHtml = unified().use(remarkRehype);

export function documentUrl(spaceKey: string, slug: string) {
  return new URL(`/s/${spaceKey}/${encodeURIComponent(slug)}`, process.env.AUTH_URL ?? "http://localhost:3000");
}

export function linkedPageSlugs(content: string, source: URL, targetSpaceKey: string, options: WikiLinkOptions) {
  const tree = parser.parse(content);
  remarkWikiLinks(options)(tree, { value: content });
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
