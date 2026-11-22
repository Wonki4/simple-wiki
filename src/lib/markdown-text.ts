import { decodeString } from "micromark-util-decode-string";

// The parser decodes these tokens in text nodes. Keep their source positions so
// editing can reveal the exact spelling, including escaped wiki-link brackets.
export const textTokenPattern = /\\[!-/:-@[-`{-~]|&(?:#[xX][\da-fA-F]+|#\d+|[a-zA-Z][\da-zA-Z]*);/g;
export { decodeString };

export function textSourceOffsets(raw: string, value: string): number[] | null {
  const offsets: number[] = [];
  let decoded = "", end = 0;
  function append(text: string, from: number, token = false) {
    for (let i = 0; i < text.length; i++) { decoded += text[i]; offsets.push(from + (token ? 0 : i)); }
  }
  for (const match of raw.matchAll(textTokenPattern)) {
    append(raw.slice(end, match.index), end);
    const text = decodeString(match[0]);
    append(text, match.index, text !== match[0]);
    end = match.index + match[0].length;
  }
  append(raw.slice(end), end);
  // Continuation lines can contain quote/list prefixes absent from node.value.
  const result: number[] = [];
  let cursor = 0;
  for (let i = 0; i < value.length; i++) {
    const at = decoded.indexOf(value[i], cursor);
    if (at < 0) return null;
    result.push(offsets[at]);
    cursor = at + 1;
  }
  return result;
}
