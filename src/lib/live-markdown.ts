import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import remarkRehype from "remark-rehype";
import rehypeSanitize from "rehype-sanitize";
import rehypeStringify from "rehype-stringify";
import type { Definition, Root, RootContent, PhrasingContent } from "mdast";
import { visit } from "unist-util-visit";
import type { Element } from "hast";
import { remarkWikiLinks, type WikiLinkOptions } from "./wiki-links";
import { markdownSchema } from "./markdown-schema";
import { footnoteLinks } from "./footnote-links";
import { decodeString, textTokenPattern } from "./markdown-text";

export interface LivePart {
  from: number;
  to: number;
  kind: "line" | "mark" | "hide" | "widget";
  className?: string;
  tag?: string;
  html?: string;
  block?: boolean;
  taskOffset?: number;
}

const parser = unified().use(remarkParse).use(remarkGfm);

// Positions always refer to the original Markdown. Formatting never serializes
// the document back to Markdown, so whitespace and unsupported syntax survive.
export function liveMarkdown(source: string, options: WikiLinkOptions, cache = new Map<string, string>()): LivePart[] {
  const tree = parser.parse(source);
  const parts: LivePart[] = [];
  const renderer = unified().use(remarkWikiLinks, options).use(remarkRehype)
    .use(rehypeSanitize, markdownSchema).use(footnoteLinks).use(rehypeStringify);
  const definitions: Definition[] = [];
  let hasFootnotes = false;
  visit(tree, node => {
    if (node.type === "definition") definitions.push(node);
    if (node.type === "footnoteDefinition") hasFootnotes = true;
  });
  const footnotes = new Map<number, string>();
  const contextualHtml = new Map<string, string>();
  if (hasFootnotes) {
    const html = renderer.runSync(structuredClone(tree), { value: source });
    let number = 0;
    visit(html, "element", node => {
      const from = node.position?.start.offset;
      if (from === undefined) return;
      contextualHtml.set(`${from}:${node.position?.end.offset}:${node.tagName}`,
        String(renderer.stringify({ type: "root", children: [node] })));
      if (node.tagName === "sup" && node.children.some(child => child.type === "element" && child.properties.dataFootnoteRef)) {
        footnotes.set(from, String(renderer.stringify({ type: "root", children: [node] })));
      } else if (node.tagName === "li" && String(node.properties.id).includes("-fn-")) {
        const list: Element = { type: "element", tagName: "ol", properties: { start: ++number }, children: [node] };
        footnotes.set(from, String(renderer.stringify({ type: "root", children: [list] })));
      }
    });
  }
  const definitionKey = definitions.map(node => source.slice(node.position!.start.offset, node.position!.end.offset)).join("\n");
  function render(node: RootContent, inline = false) {
    // References in tables and images must share the whole document's footnote
    // numbering/definitions, rather than starting a fresh numbering per widget.
    const tag = ({ paragraph: "p", table: "table", code: "pre", thematicBreak: "hr", link: "a", linkReference: "a", image: "img", imageReference: "img", inlineCode: "code" } as Record<string, string>)[node.type];
    const contextual = contextualHtml.get(`${node.position!.start.offset}:${node.position!.end.offset}:${tag}`);
    if (contextual) return contextual;
    const key = `${inline}:${source.slice(node.position!.start.offset, node.position!.end.offset)}:${definitionKey}`;
    if (cache.has(key)) return cache.get(key)!;
    const root: Root = { type: "root", children: [inline
      ? { type: "paragraph", children: [structuredClone(node) as PhrasingContent] }
      : structuredClone(node), ...definitions] };
    const html = String(renderer.stringify(renderer.runSync(root, { value: source })));
    const result = inline ? html.replace(/^<p>/, "").replace(/<\/p>$/, "") : html;
    if (cache.size > 500) cache.clear();
    cache.set(key, result);
    return result;
  }
  function add(kind: LivePart["kind"], from: number, to: number, extra: Partial<LivePart> = {}) {
    if (to > from || kind === "line") parts.push({ kind, from, to, ...extra });
  }
  function walk(node: RootContent, ordinal?: number) {
    const from = node.position?.start.offset;
    const to = node.position?.end.offset;
    if (from === undefined || to === undefined) return;
    const raw = source.slice(from, to);
    if (node.type === "list") {
      node.children.forEach((item, index) => walk(item, node.ordered ? (node.start ?? 1) + index : undefined));
      return;
    }
    if (node.type === "footnoteReference" || node.type === "footnoteDefinition") {
      const html = footnotes.get(from);
      if (html) { add("widget", from, to, { html, block: node.type === "footnoteDefinition" }); return; }
    }
    if (["code", "table", "thematicBreak"].includes(node.type)) {
      add("widget", from, to, { html: render(node), block: true });
      return;
    }
    if (node.type === "paragraph" && node.children.length === 1 && ["image", "imageReference"].includes(node.children[0].type)) {
      add("widget", from, to, { html: render(node), block: true });
      return;
    }
    if (["link", "linkReference", "image", "imageReference", "inlineCode"].includes(node.type)) {
      add("widget", from, to, { html: render(node, true) });
      return;
    }
    if (node.type === "html" || node.type === "definition") return;
    if (node.type === "heading") {
      add("line", from, to, { className: `live-heading live-h${node.depth}` });
      const opening = /^ {0,3}#{1,6}(?:[ \t]+|$)/.exec(raw);
      if (opening) {
        add("hide", from, from + opening[0].length);
        const closing = /[ \t]+#+[ \t]*$/.exec(raw);
        if (closing) add("hide", from + closing.index, to);
      } else {
        const underline = /\n {0,3}(?:=+|-+)\s*$/.exec(raw);
        if (underline) add("hide", from + underline.index, to);
      }
    }
    if (node.type === "blockquote") {
      let offset = from;
      for (const line of raw.split("\n")) {
        add("line", offset, offset + line.length, { className: "live-quote" });
        const marker = /^(?: {0,3}> ?)+/.exec(line);
        if (marker) add("hide", offset, offset + marker[0].length);
        offset += line.length + 1;
      }
    }
    if (node.type === "listItem") {
      const marker = /^(?:[-+*]|\d+[.)])(?:[ \t]+|$)(?:\[[ xX]\][ \t]+)?/.exec(raw);
      if (marker) {
        const task = typeof node.checked === "boolean";
        const bullet = ordinal === undefined ? "•" : `${ordinal}.`;
        add("widget", from, from + marker[0].length, task ? {
          html: `<input class="live-task" type="checkbox" aria-label="완료 표시"${node.checked ? " checked" : ""}> `,
          taskOffset: marker[0].indexOf("[") + 1,
        } : { html: `<span class="live-bullet">${bullet} </span>` });
      }
    }
    if (node.type === "break") {
      add("hide", from, to - 1); // Keep the actual newline while hiding its Markdown marker.
      return;
    }
    const tag = ({ strong: "strong", emphasis: "em", delete: "s" } as Record<string, string>)[node.type];
    if (tag) {
      add("mark", from, to, { tag });
      if ("children" in node) {
        add("hide", from, node.children[0].position!.start.offset!);
        add("hide", node.children.at(-1)!.position!.end.offset!, to);
      }
    }
    if (node.type === "text") {
      const links: { from: number; to: number }[] = [];
      for (const match of raw.matchAll(/\[\[[^\[\]\r\n]+\]\]/g)) {
        let slashes = 0;
        for (let i = match.index - 1; raw[i] === "\\"; i--) slashes++;
        if (slashes % 2) continue;
        const key = `wiki:${match[0]}`;
        let html = cache.get(key);
        if (html === undefined) {
          // Parse once per distinct link. Use its own source positions for rendering.
          const root = parser.parse(match[0]);
          html = String(renderer.stringify(renderer.runSync(root, { value: match[0] }))).replace(/^<p>/, "").replace(/<\/p>$/, "");
          if (cache.size > 500) cache.clear();
          cache.set(key, html);
        }
        add("widget", from + match.index, from + match.index + match[0].length, {
          html,
        });
        links.push({ from: match.index, to: match.index + match[0].length });
      }
      for (const match of raw.matchAll(textTokenPattern)) {
        if (links.some(link => match.index >= link.from && match.index < link.to)) continue;
        const value = decodeString(match[0]);
        if (value === match[0]) continue;
        // Stringify a text node: entities such as &lt;script&gt; stay inert.
        add("widget", from + match.index, from + match.index + match[0].length, {
          html: String(renderer.stringify({ type: "root", children: [{ type: "text", value }] })),
        });
      }
    }
    if ("children" in node) for (const child of node.children) walk(child as RootContent);
  }
  for (const child of tree.children) walk(child);
  return parts.sort((a, b) => a.from - b.from || b.to - a.to);
}
