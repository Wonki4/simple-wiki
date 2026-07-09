import { visit } from "unist-util-visit";
import type { Root, Text, PhrasingContent } from "mdast";
import { slugify } from "./slug";

const WIKI_LINK_RE = /\[\[([^\[\]|]+)(?:\|([^\[\]]+))?\]\]/g;

export interface WikiLink {
  target: string;
  label: string;
  slug: string;
}

export function extractWikiLinks(markdown: string): WikiLink[] {
  const links: WikiLink[] = [];
  const seen = new Set<string>();
  for (const m of markdown.matchAll(WIKI_LINK_RE)) {
    const target = m[1].trim();
    const slug = slugify(target);
    if (!slug || seen.has(slug)) continue;
    seen.add(slug);
    links.push({ target, label: (m[2] ?? target).trim(), slug });
  }
  return links;
}

interface WikiLinkOptions {
  spaceKey: string;
  existingSlugs: Set<string>;
}

export function remarkWikiLinks(options: WikiLinkOptions) {
  return (tree: Root) => {
    visit(tree, "text", (node: Text, index, parent) => {
      if (!parent || index === undefined) return;
      const value = node.value;
      WIKI_LINK_RE.lastIndex = 0;
      if (!WIKI_LINK_RE.test(value)) return;
      WIKI_LINK_RE.lastIndex = 0;

      const children: PhrasingContent[] = [];
      let last = 0;
      for (const m of value.matchAll(WIKI_LINK_RE)) {
        if (m.index! > last) children.push({ type: "text", value: value.slice(last, m.index) });
        const target = m[1].trim();
        const label = (m[2] ?? target).trim();
        const slug = slugify(target);
        const exists = options.existingSlugs.has(slug);
        const url = exists
          ? `/s/${options.spaceKey}/${encodeURIComponent(slug)}`
          : `/s/${options.spaceKey}/new?title=${encodeURIComponent(target)}`;
        children.push({
          type: "link",
          url,
          data: {
            hProperties: { className: exists ? ["wiki-link"] : ["wiki-link", "wiki-link-missing"] },
          },
          children: [{ type: "text", value: label }],
        } as unknown as PhrasingContent);
        last = m.index! + m[0].length;
      }
      if (last < value.length) children.push({ type: "text", value: value.slice(last) });
      parent.children.splice(index, 1, ...children);
      return index + children.length;
    });
  };
}
