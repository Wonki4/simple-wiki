import { slugify } from "./slug";
import { extractWikiLinks } from "./wiki-links";

export interface LinkPage {
  title: string;
  slug: string;
}

export function linkAtCaret(text: string, caret: number) {
  const start = text.lastIndexOf("[[", caret - 2);
  if (start < 0 || start + 2 > caret) return null;
  const query = text.slice(start + 2, caret);
  if (/[\[\]|\r\n]/.test(query)) return null;
  let escaped = false;
  for (let i = start - 1; text[i] === "\\"; i--) escaped = !escaped;
  if (escaped) return null;

  // Editing an existing target also replaces its suffix and reuses its label.
  const rest = /^[^\[\]|\r\n]*(?:\|([^\[\]\r\n]+))?\]\]/.exec(text.slice(caret));
  const end = rest ? caret + rest[0].length : caret + (text[caret] === "]" ? 1 : 0);
  return { start, end, query, label: rest?.[1] };
}

export function matchingPages(pages: readonly LinkPage[], query: string): LinkPage[] {
  const needle = query.trim().normalize("NFC").toLowerCase();
  const prefix: LinkPage[] = [];
  const partial: LinkPage[] = [];
  for (const page of pages) {
    const title = page.title.normalize("NFC").toLowerCase();
    if (title.startsWith(needle) || page.slug.startsWith(needle)) prefix.push(page);
    else if (partial.length < 8 && (title.includes(needle) || page.slug.includes(needle))) partial.push(page);
    if (prefix.length === 8) break;
  }
  return [...prefix, ...partial].slice(0, 8);
}

export function completedLink(page: LinkPage, label?: string) {
  const target = slugify(page.title) === page.slug && !/[\[\]|\r\n]/.test(page.title) ? page.title : page.slug;
  const display = label ?? (target === page.title ? null : page.title);
  const candidate = display ? `[[${target}|${display}]]` : `[[${target}]]`;
  // Some titles (e.g. inline code) cannot be represented inside a Markdown text node.
  const [parsed] = extractWikiLinks(candidate);
  if (parsed?.slug === page.slug && parsed.label === (display ?? target)) return candidate;
  return label ? `[[${page.slug}|${label}]]` : `[[${page.slug}]]`;
}
