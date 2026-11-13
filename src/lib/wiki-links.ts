import { SKIP, visit } from "unist-util-visit";
import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import type { Root, PhrasingContent } from "mdast";
import { slugify } from "./slug";

const parser = unified().use(remarkParse).use(remarkGfm);
const wikiLinkPattern = /\[\[([^\[\]|\r\n]+)(?:\|([^\[\]\r\n]+))?\]\]/g;

export interface WikiLink {
  target: string;
  label: string;
  slug: string;
}

// 렌더링과 백링크 색인이 같은 텍스트 노드를 해석한다. 기존 링크 안에는 링크를 중첩하지 않는다.
function walkWikiLinks(tree: Root, onLink: (link: WikiLink) => PhrasingContent | void) {
  visit(tree, (node, index, parent) => {
    if (node.type === "link" || node.type === "linkReference") return SKIP;
    if (node.type !== "text" || index === undefined || !parent) return;
    const children: PhrasingContent[] = [];
    let end = 0;
    for (const match of node.value.matchAll(wikiLinkPattern)) {
      const target = match[1].trim();
      const slug = slugify(target);
      if (!slug) continue;
      const link = onLink({ target, slug, label: (match[2] ?? target).trim() });
      if (!link) continue;
      if (end < match.index) children.push({ type: "text", value: node.value.slice(end, match.index) });
      children.push(link);
      end = match.index + match[0].length;
    }
    if (!children.length) return;
    if (end < node.value.length) children.push({ type: "text", value: node.value.slice(end) });
    parent.children.splice(index, 1, ...children);
    return index + children.length;
  });
}

export function extractWikiLinks(markdown: string): WikiLink[] {
  const links = new Map<string, WikiLink>();
  walkWikiLinks(parser.parse(markdown), (link) => {
    if (!links.has(link.slug)) links.set(link.slug, link);
  });
  return [...links.values()];
}

export interface WikiLinkOptions {
  spaceKey: string;
  destinations: Map<string, string>;
}

export function remarkWikiLinks({ spaceKey, destinations }: WikiLinkOptions) {
  return (tree: Root) => walkWikiLinks(tree, ({ slug, target, label }) => {
    const destination = destinations.get(slug);
    return {
      type: "link",
      url: destination
        ? `/s/${spaceKey}/${encodeURIComponent(destination)}`
        : `/s/${spaceKey}/new?title=${encodeURIComponent(target)}`,
      data: { hProperties: { className: destination ? ["wiki-link"] : ["wiki-link", "wiki-link-missing"] } },
      children: [{ type: "text", value: label }],
    };
  });
}
