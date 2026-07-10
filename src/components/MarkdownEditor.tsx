"use client";

import { useEffect, useRef, useState } from "react";
import type EditorType from "@toast-ui/editor";
import "@toast-ui/editor/dist/toastui-editor.css";
import "@toast-ui/editor/dist/theme/toastui-editor-dark.css";

interface Props {
  spaceKey: string;
  initialTitle: string;
  initialContent: string;
  onSave: (formData: FormData) => Promise<void>;
}

// WYSIWYG 직렬화는 리터럴 대괄호를 이스케이프(\[)할 수 있다.
// 위키링크 [[페이지명]]이 깨지지 않도록 되돌린다.
function cleanMarkdown(md: string): string {
  return md.replace(/\\\[/g, "[").replace(/\\\]/g, "]");
}

export function MarkdownEditor({ spaceKey, initialTitle, initialContent, onSave }: Props) {
  const [title, setTitle] = useState(initialTitle);
  const [content, setContent] = useState(initialContent);
  const [saving, setSaving] = useState(false);
  const holderRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<EditorType | null>(null);

  useEffect(() => {
    let editor: EditorType | null = null;
    let disposed = false;

    (async () => {
      const { default: Editor } = await import("@toast-ui/editor");
      if (disposed || !holderRef.current) return;
      const isDark =
        typeof window !== "undefined" &&
        window.matchMedia("(prefers-color-scheme: dark)").matches;

      editor = new Editor({
        el: holderRef.current,
        initialValue: initialContent,
        initialEditType: "wysiwyg",
        previewStyle: "tab",
        hideModeSwitch: true,
        height: "auto",
        minHeight: "480px",
        theme: isDark ? "dark" : "light",
        usageStatistics: false,
        autofocus: false,
        toolbarItems: [
          ["heading", "bold", "italic", "strike"],
          ["hr", "quote"],
          ["ul", "ol", "task"],
          ["table", "image", "link"],
          ["code", "codeblock"],
        ],
        hooks: {
          addImageBlobHook: async (blob: Blob, callback: (url: string, altText: string) => void) => {
            try {
              const fd = new FormData();
              fd.append("file", blob);
              const res = await fetch(`/api/spaces/${spaceKey}/attachments`, {
                method: "POST",
                body: fd,
              });
              if (!res.ok) throw new Error("upload failed");
              const { url, filename } = (await res.json()) as {
                url: string;
                filename: string;
              };
              callback(url, filename);
            } catch {
              alert("이미지 업로드에 실패했습니다.");
            }
          },
        },
      });

      editor.on("change", () => {
        setContent(cleanMarkdown(editor!.getMarkdown()));
      });
      editorRef.current = editor;
    })();

    return () => {
      disposed = true;
      editor?.destroy();
      editorRef.current = null;
    };
    // 마운트 시 한 번만 생성한다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <form
      action={async (fd) => {
        // 제출 시점의 최신 마크다운을 확실히 반영한다.
        if (editorRef.current) fd.set("content", cleanMarkdown(editorRef.current.getMarkdown()));
        setSaving(true);
        try {
          await onSave(fd);
        } catch {
          alert("저장에 실패했습니다. 잠시 후 다시 시도하세요.");
        } finally {
          setSaving(false);
        }
      }}
    >
      <input
        name="title"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        required
        placeholder="제목"
        className="input input-title"
      />
      <input type="hidden" name="content" value={content} />
      <div className="wysiwyg mt-4" ref={holderRef} />
      <p className="meta mt-2.5">
        이미지를 붙여넣거나 툴바로 올릴 수 있습니다. [[페이지명]]으로 위키링크를 만들 수 있습니다.
      </p>
      <button disabled={saving} className="btn btn-primary mt-4">
        {saving ? "저장 중..." : "저장"}
      </button>
    </form>
  );
}
