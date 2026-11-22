"use client";

import { useEffect, useRef, type RefObject } from "react";
import { Compartment, EditorState } from "@codemirror/state";
import { EditorView, keymap, placeholder } from "@codemirror/view";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { markdown } from "@codemirror/lang-markdown";
import { defaultHighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { livePreview, setWikiOptions, uploadAnchors } from "@/lib/live-editor";
import type { WikiLinkOptions } from "@/lib/wiki-links";

interface Props {
  initialContent: string;
  options: WikiLinkOptions;
  readOnly: boolean;
  viewRef: RefObject<EditorView | null>;
  onChange: (content: string) => void;
  onReady: () => void;
  onFiles: (files: File[]) => void;
}

export function LiveMarkdownEditor(props: Props) {
  const holder = useRef<HTMLDivElement>(null);
  const current = useRef(props);
  current.current = props;
  const editable = useRef(new Compartment());
  useEffect(() => {
    const view = new EditorView({
      parent: holder.current!,
      state: EditorState.create({
        doc: current.current.initialContent.replace(/\r\n?/g, "\n"),
        extensions: [
          history(), keymap.of([...historyKeymap, ...defaultKeymap]), markdown(),
          syntaxHighlighting(defaultHighlightStyle, { fallback: true }), EditorView.lineWrapping,
          placeholder("본문을 입력하세요. 마크다운 서식이 이 자리에서 표시됩니다."),
          EditorView.contentAttributes.of({ "aria-label": "본문", spellcheck: "false" }),
          editable.current.of(EditorState.readOnly.of(current.current.readOnly)),
          livePreview(current.current.options), uploadAnchors,
          EditorView.updateListener.of(update => {
            if (update.docChanged) current.current.onChange(update.state.doc.toString());
          }),
          EditorView.domEventHandlers({
            paste(event, view) {
              const files = Array.from(event.clipboardData?.files ?? []);
              if (!files.length) return false;
              event.preventDefault();
              if (!view.state.readOnly) current.current.onFiles(files);
              return true;
            },
            drop(event, view) {
              const files = Array.from(event.dataTransfer?.files ?? []);
              if (!files.length) return false;
              event.preventDefault();
              if (!view.state.readOnly) {
                const at = view.posAtCoords({ x: event.clientX, y: event.clientY });
                if (at !== null) view.dispatch({ selection: { anchor: at } });
                current.current.onFiles(files);
              }
              return true;
            },
          }),
        ],
      }),
    });
    current.current.viewRef.current = view;
    current.current.onReady();
    return () => { current.current.viewRef.current = null; view.destroy(); };
  }, []);
  useEffect(() => {
    props.viewRef.current?.dispatch({ effects: editable.current.reconfigure(EditorState.readOnly.of(props.readOnly)) });
  }, [props.readOnly, props.viewRef]);
  useEffect(() => {
    props.viewRef.current?.dispatch({ effects: setWikiOptions.of(props.options) });
  }, [props.options, props.viewRef]);
  return <div ref={holder} />;
}
