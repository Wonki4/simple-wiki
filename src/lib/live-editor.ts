import { EditorState, StateEffect, StateField, type Range, type Text } from "@codemirror/state";
import { Decoration, EditorView, ViewPlugin, WidgetType, type DecorationSet, type ViewUpdate } from "@codemirror/view";
import { liveMarkdown, type LivePart } from "./live-markdown";
import type { WikiLinkOptions } from "./wiki-links";
import { createCodeHighlighter, type CodeHighlighter } from "./live-code-highlight";
import { addCodeCopyButtons } from "./code-copy";

const codeCopyCleanup = new WeakMap<HTMLElement, () => void>();

class MarkdownWidget extends WidgetType {
  constructor(readonly html: string, readonly block: boolean, readonly highlighter: CodeHighlighter, readonly taskOffset?: number) { super(); }
  eq(other: MarkdownWidget) { return this.html === other.html && this.block === other.block && this.taskOffset === other.taskOffset; }
  toDOM(view: EditorView) {
    const element: HTMLElement = document.createElement(this.block ? "div" : "span");
    element.className = this.block ? "live-rendered live-block prose-wiki" : "live-rendered live-inline";
    element.innerHTML = this.html;
    codeCopyCleanup.set(element, addCodeCopyButtons(element));
    // A normal click edits. Modified link clicks retain the browser's open-tab behavior.
    element.addEventListener("mousedown", event => {
      if (event.target instanceof Element && event.target.closest("button.code-copy")) {
        event.preventDefault(); // Keep the editing selection and rendered block in place.
        return;
      }
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || view.state.readOnly) return;
      event.preventDefault();
      if (this.taskOffset !== undefined) return;
      const from = view.posAtDOM(element);
      view.dispatch({ selection: { anchor: from }, scrollIntoView: true });
      view.focus();
    });
    element.addEventListener("click", event => {
      if (!event.metaKey && !event.ctrlKey && !event.shiftKey) event.preventDefault();
      if (this.taskOffset !== undefined && !view.state.readOnly) {
        const from = view.posAtDOM(element) + this.taskOffset;
        view.dispatch({ changes: { from, to: from + 1, insert: /x/i.test(view.state.sliceDoc(from, from + 1)) ? " " : "x" }, userEvent: "input.task" });
      }
    });
    for (const code of element.querySelectorAll("pre > code")) {
      const language = [...code.classList].find(name => name.startsWith("language-"))?.slice(9);
      if (!language) continue;
      const pre = code.parentElement!;
      void this.highlighter.highlight(code.textContent ?? "", language).then(html => {
        if (!html || !pre.isConnected) return;
        const highlighted = new DOMParser().parseFromString(html, "text/html").querySelector("pre.shiki");
        if (highlighted) { pre.replaceWith(highlighted); view.requestMeasure(); }
      });
    }
    for (const image of element.querySelectorAll("img")) {
      image.addEventListener("load", () => view.requestMeasure(), { once: true });
      image.addEventListener("error", () => view.requestMeasure(), { once: true });
    }
    return element;
  }
  destroy(element: HTMLElement) { codeCopyCleanup.get(element)?.(); codeCopyCleanup.delete(element); }
  ignoreEvent() { return true; }
}

function decorations(state: EditorState, parts: LivePart[], focused: boolean, highlighter: CodeHighlighter): DecorationSet {
  const ranges: Range<Decoration>[] = [];
  const active = focused ? state.selection.ranges.map(range => ({
    from: state.doc.lineAt(range.from).from,
    to: state.doc.lineAt(!range.empty && range.to > range.from ? range.to - 1 : range.to).to,
  })) : [];
  // Opening a block also reveals surrounding syntax on all of its lines, such
  // as quote prefixes inside a fenced code block or a multi-line footnote.
  for (const part of parts) {
    if (part.kind === "widget" && part.block && active.some(line => part.from <= line.to && part.to > line.from)) {
      active.push({ from: state.doc.lineAt(part.from).from, to: state.doc.lineAt(part.to - 1).to });
    }
  }
  const lines = new Map<number, Set<string>>();
  let replacedUntil = -1;
  for (const part of parts) {
    if (part.kind === "line") {
      const from = state.doc.lineAt(part.from).from;
      if (!lines.has(from)) lines.set(from, new Set());
      lines.get(from)!.add(part.className!);
    } else if (part.kind === "mark") {
      ranges.push(Decoration.mark({ tagName: part.tag, class: part.className }).range(part.from, part.to));
    } else if (!active.some(line => part.from <= line.to && part.to > line.from) && part.from >= replacedUntil) {
      ranges.push(Decoration.replace({
        ...(part.kind === "widget" && { widget: new MarkdownWidget(part.html!, !!part.block, highlighter, part.taskOffset) }),
        block: !!part.block,
      }).range(part.from, part.to));
      replacedUntil = part.to;
    }
  }
  for (const [from, classes] of lines) ranges.push(Decoration.line({ class: [...classes].join(" ") }).range(from));
  return Decoration.set(ranges, true);
}

export const setWikiOptions = StateEffect.define<WikiLinkOptions>();
export function livePreview(initialOptions: WikiLinkOptions) {
  const highlighter = createCodeHighlighter(initialOptions.spaceKey);
  const renderCache = new Map<string, string>();
  const focus = StateEffect.define<boolean>();
  const parsed = StateEffect.define<{ doc: Text; parts: LivePart[] }>();
  const field = StateField.define<{ parts: LivePart[]; focused: boolean; options: WikiLinkOptions; decorations: DecorationSet }>({
    create(state) {
      const parts = liveMarkdown(state.doc.toString(), initialOptions, renderCache);
      return { parts, focused: false, options: initialOptions, decorations: decorations(state, parts, false, highlighter) };
    },
    update(value, transaction) {
      const focused = transaction.effects.find(effect => effect.is(focus))?.value ?? value.focused;
      const options = transaction.effects.find(effect => effect.is(setWikiOptions))?.value ?? value.options;
      const result = transaction.effects.find(effect => effect.is(parsed))?.value;
      if (!transaction.docChanged && !transaction.selection && !result && focused === value.focused && options === value.options) return value;
      if (options !== value.options) renderCache.clear();
      // Keep keystrokes/IME synchronous and cheap. The parser runs after a short
      // idle interval; selection changes can immediately reveal mapped source.
      const parts = result?.doc === transaction.newDoc ? result.parts
        : options !== value.options ? liveMarkdown(transaction.newDoc.toString(), options, renderCache)
        : transaction.docChanged ? value.parts.map(part => ({ ...part,
          from: transaction.changes.mapPos(part.from, 1), to: transaction.changes.mapPos(part.to, -1),
        })).filter(part => part.to > part.from || part.kind === "line") : value.parts;
      return { parts, focused, options, decorations: decorations(transaction.state, parts, focused, highlighter) };
    },
    provide: field => EditorView.decorations.from(field, value => value.decorations),
  });
  const parsing = ViewPlugin.fromClass(class {
    timer = 0;
    constructor(readonly view: EditorView) {}
    update(update: ViewUpdate) {
      if (!update.docChanged && !(this.timer && update.selectionSet)) return;
      window.clearTimeout(this.timer);
      this.timer = window.setTimeout(() => {
        this.timer = 0;
        const { state } = this.view;
        const parts = liveMarkdown(state.doc.toString(), state.field(field).options, renderCache);
        this.view.dispatch({ effects: parsed.of({ doc: state.doc, parts }) });
      }, update.docChanged ? 80 : 0);
    }
    destroy() { window.clearTimeout(this.timer); highlighter.destroy(); }
  });
  return [field, parsing, EditorView.focusChangeEffect.of((_state, focused) => focus.of(focused))];
}

const addAnchor = StateEffect.define<{ id: symbol; from: number; to: number }>();
const removeAnchor = StateEffect.define<symbol>();
export const uploadAnchors = StateField.define<Map<symbol, { from: number; to: number }>>({
  create: () => new Map(),
  update(previous, tr) {
    const next = new Map([...previous].map(([id, range]) => [id, {
      from: tr.changes.mapPos(range.from, 1), to: tr.changes.mapPos(range.to, 1),
    }]));
    for (const effect of tr.effects) {
      if (effect.is(addAnchor)) next.set(effect.value.id, effect.value);
      if (effect.is(removeAnchor)) next.delete(effect.value);
    }
    return next;
  },
});

// Failed uploads keep their original insertion point, even after later edits.
export function uploadAnchor(view: EditorView, from: number, to = from) {
  const id = Symbol();
  view.dispatch({ effects: addAnchor.of({ id, from, to }) });
  return {
    discard() { view.dispatch({ effects: removeAnchor.of(id) }); },
    insert(text: string) {
      const range = view.state.field(uploadAnchors).get(id);
      if (!range) return;
      view.dispatch({ changes: { ...range, insert: text }, selection: { anchor: range.from + text.length },
        effects: removeAnchor.of(id), userEvent: "input.upload", scrollIntoView: true });
    },
  };
}
