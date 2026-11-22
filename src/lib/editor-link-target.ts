import type { EditorView } from "@codemirror/view";
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

export function liveLinkTarget(view: EditorView): LinkTarget | null {
  const { selection, doc } = view.state;
  if (view.state.readOnly || !view.hasFocus || !selection.main.empty || view.compositionStarted) return null;
  const token = linkAtCaret(doc.toString(), selection.main.head);
  if (!token || inLiteral(doc.toString(), token.start)) return null;
  return {
    ...token, input: view.contentDOM,
    rect: () => view.coordsAtPos(selection.main.head) ?? view.contentDOM.getBoundingClientRect(),
    replace(link) {
      view.dispatch({ changes: { from: token.start, to: token.end, insert: link },
        selection: { anchor: token.start + link.length }, scrollIntoView: true, userEvent: "input.complete" });
    },
  };
}
