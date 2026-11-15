import { SKIP, visit } from "unist-util-visit";
import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import type { Root, PhrasingContent } from "mdast";
import { sectionId, slugify } from "./slug";

const parser = unified().use(remarkParse).use(remarkGfm);
const wikiLinkPattern = /\[\[([^\[\]|\r\n]+)(?:\|([^\[\]\r\n]+))?\]\]/g;

export interface WikiLink {
  target: string;
  label: string;
  slug: string;
  space?: string;
  section?: string;
}

export function splitWikiTarget(target: string) {
  const scope = /^([a-z0-9][a-z0-9-]{1,31}):/.exec(target);
  const rest = target.slice(scope?.[0].length ?? 0);
  const hash = rest.indexOf("#");
  return { space: scope?.[1], name: (hash < 0 ? rest : rest.slice(0, hash)).trim(),
    section: hash < 0 ? undefined : rest.slice(hash + 1).trim() };
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
      const { space, name, section } = splitWikiTarget(target);
      const slug = slugify(name);
      if (!slug && !(section && !space && !name)) continue;
      const link = onLink({ target, slug, label: (match[2] ?? target).trim(),
        ...(space && { space }), ...(section !== undefined && { section }) });
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
    const key = JSON.stringify([link.space, link.slug, link.section === undefined ? null : link.target]);
    if (!links.has(key)) links.set(key, link);
  });
  return [...links.values()];
}

export interface WikiLinkOptions {
  spaceKey: string;
  destinations: Map<string, string>;
  otherSpaces?: Map<string, Map<string, string>>;
}

type ResolvedWikiLink =
  | { kind: "missing"; spaceKey: string; title: string }
  | { kind: "page"; spaceKey: string; slug: string; section?: string };

// 빈 slug는 현재 문서, null은 열람 범위 밖의 스페이스다.
export function resolveWikiLink(link: WikiLink, options: WikiLinkOptions): ResolvedWikiLink | null {
  // ':'와 '#'가 들어간 기존 로컬 문서의 제목을 먼저 확인한다.
  if (link.slug && (link.space || link.section !== undefined)) {
    const literal = options.destinations.get(slugify(link.target));
    if (literal) return { kind: "page", spaceKey: options.spaceKey, slug: literal };
  }

  const spaceKey = link.space ?? options.spaceKey;
  const names = spaceKey === options.spaceKey ? options.destinations : options.otherSpaces?.get(spaceKey);
  if (!names) return null;
  const slug = link.slug ? names.get(link.slug) : "";
  return slug === undefined
    ? { kind: "missing", spaceKey, title: splitWikiTarget(link.target).name }
    : { kind: "page", spaceKey, slug, section: link.section };
}

export function remarkWikiLinks(options: WikiLinkOptions) {
  return (tree: Root) => walkWikiLinks(tree, link => {
    const target = resolveWikiLink(link, options);
    const text = { type: "text" as const, value: link.label };
    if (!target || (link.space && target.kind === "missing")) return text;

    const home = `/s/${target.spaceKey}`;
    if (target.kind === "missing") return {
      type: "link", url: `${home}/new?title=${encodeURIComponent(target.title)}`,
      data: { hProperties: { className: ["wiki-link", "wiki-link-missing"] } }, children: [text],
    };
    const fragment = target.section ? `#${encodeURIComponent(sectionId(target.section))}` : "";
    return {
      type: "link", url: (target.slug ? `${home}/${encodeURIComponent(target.slug)}` : "") + fragment,
      data: { hProperties: { className: ["wiki-link"] } }, children: [text],
    };
  });
}
