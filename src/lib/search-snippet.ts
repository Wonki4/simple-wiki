// ts_headline adds its own double brackets inside Markdown. Protect those markers
// before unwrapping wiki links, then hand React plain text and highlight spans.
export function snippetParts(snippet: string) {
  const text = snippet.replaceAll("\u0001", "").replaceAll("\u0002", "")
    .replaceAll("[[HL]]", "\u0001").replaceAll("[[/HL]]", "\u0002")
    .replace(/\[\[([^\[\]|]+)(?:\|([^\[\]]+))?\]\]/g, (_, target: string, label?: string) => label ?? target)
    // A headline can begin or end halfway through a wiki link or table.
    .replace(/^[^\n[\]]*?\]\]/, (prefix) => prefix.slice(0, -2))
    .replace(/\[\[([^\n[\]]*)$/, "$1")
    .replace(/^\s*\|?\s*:?-{3,}:?\s*\|[\s|:-]*$/gm, "")
    .replace(/^[ \t]*\|([^\n]*)/gm, (_, row: string) => row.replace(/\|/g, " "))
    .replace(/!?\[([^\]]*)\]\([^()\s]+\)/g, "$1")
    .replace(/(^|\s)#{1,6}(?=\s)/g, "$1")
    .replace(/(\*\*|~~|`)(.+?)\1/g, "$2")
    .replace(/\s+/g, " ").trim();

  return text.split(/\u0001([^\u0002]*)\u0002/g).map((value, i) => ({ value, highlighted: i % 2 === 1 }));
}
