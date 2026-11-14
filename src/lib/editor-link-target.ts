import type { EditorView } from "@milkdown/kit/prose/view";
import { TextSelection } from "@milkdown/kit/prose/state";
import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import { visit, EXIT } from "unist-util-visit";
import { linkAtCaret } from "./wiki-link-completion";

export interface LinkTarget {
  query: string;
  label?: string;
  start: number;
  input: HTMLElement;
  rect: () => Pick<DOMRect, "top" | "bottom" | "left">;
  replace: (link: string) => void;
}

const parser = unified().use(remarkParse).use(remarkGfm);
function inLiteral(source: string, offset: number) {
  let literal = false;
  visit(parser.parse(source), node => {
    const start = node.position?.start.offset;
    const end = node.position?.end.offset;
    if (start === undefined || end === undefined || offset < start || offset >= end) return;
    if (["code", "inlineCode", "link", "linkReference", "image", "html", "definition"].includes(node.type)) {
      literal = true;
      return EXIT;
    }
  });
  return literal;
}

// A textarea does not expose a caret rectangle. Mirror its line wrapping and scroll offset.
function textareaCaret(input: HTMLTextAreaElement) {
  const box = input.getBoundingClientRect();
  const style = getComputedStyle(input);
  const mirror = document.createElement("div");
  Object.assign(mirror.style, {
    position: "fixed", visibility: "hidden", pointerEvents: "none", boxSizing: "border-box",
    top: `${box.top + input.clientTop - input.scrollTop}px`, left: `${box.left + input.clientLeft - input.scrollLeft}px`,
    width: `${input.clientWidth}px`, padding: style.padding, font: style.font, lineHeight: style.lineHeight,
    letterSpacing: style.letterSpacing, tabSize: style.tabSize, whiteSpace: "pre-wrap", overflowWrap: "break-word",
  });
  mirror.textContent = input.value.slice(0, input.selectionStart);
  const marker = document.createElement("span");
  marker.textContent = input.value.slice(input.selectionStart).split("\n", 1)[0] || "\u200b";
  mirror.append(marker);
  document.body.append(mirror);
  const rect = marker.getClientRects()[0] ?? box;
  mirror.remove();
  return rect;
}

export function sourceLinkTarget(input: HTMLTextAreaElement, edit: (value: string) => void): LinkTarget | null {
  if (input.readOnly || document.activeElement !== input || input.selectionStart !== input.selectionEnd) return null;
  const token = linkAtCaret(input.value, input.selectionStart);
  if (!token || inLiteral(input.value, token.start)) return null;
  return {
    ...token, input, rect: () => textareaCaret(input),
    replace(link) {
      input.setRangeText(link, token.start, token.end, "end");
      edit(input.value);
    },
  };
}

export function blockLinkTarget(view: EditorView): LinkTarget | null {
  const { selection, storedMarks } = view.state;
  if (!view.editable || !view.hasFocus() || !(selection instanceof TextSelection) || !selection.empty) return null;
  const pos = selection.$from;
  if (pos.parent.type.spec.code || (storedMarks ?? pos.marks()).some(m => m.type.spec.code || m.type.name === "link")) return null;
  const text = pos.parent.textBetween(0, pos.parent.content.size, "\n", "\n");
  const token = linkAtCaret(text, pos.parentOffset);
  if (!token) return null;
  const start = pos.start() + token.start;
  const end = pos.start() + token.end;
  return {
    ...token, start, input: view.dom, rect: () => view.coordsAtPos(pos.pos),
    replace(link) {
      const tr = view.state.tr.insertText(link, start, end);
      view.dispatch(tr.setSelection(TextSelection.create(tr.doc, start + link.length)).scrollIntoView());
    },
  };
}
