"use client";

import { useEffect, useRef, useState } from "react";
import CodeMirror from "@uiw/react-codemirror";
import { markdown } from "@codemirror/lang-markdown";

interface Props {
  spaceKey: string;
  initialTitle: string;
  initialContent: string;
  onSave: (formData: FormData) => Promise<void>;
  preview: (content: string) => Promise<string>;
}

export function MarkdownEditor({ spaceKey, initialTitle, initialContent, onSave, preview }: Props) {
  const [title, setTitle] = useState(initialTitle);
  const [content, setContent] = useState(initialContent);
  const [html, setHtml] = useState("");
  const [saving, setSaving] = useState(false);
  const [tab, setTab] = useState<"write" | "preview">("write");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const previewSeq = useRef(0);

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      const seq = ++previewSeq.current;
      preview(content)
        .then((h) => {
          if (seq === previewSeq.current) setHtml(h);
        })
        .catch(() => {
          if (seq === previewSeq.current) setHtml("<p>미리보기 실패</p>");
        });
    }, 500);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [content, preview]);

  async function handlePaste(e: React.ClipboardEvent) {
    const file = Array.from(e.clipboardData.files).find((f) => f.type.startsWith("image/"));
    if (!file) return;
    e.preventDefault();
    const fd = new FormData();
    fd.append("file", file);
    const res = await fetch(`/api/spaces/${spaceKey}/attachments`, { method: "POST", body: fd });
    if (!res.ok) {
      alert("이미지 업로드에 실패했습니다.");
      return;
    }
    const { url, filename } = (await res.json()) as { url: string; filename: string };
    setContent((c) => `${c}\n![${filename}](${url})\n`);
  }

  return (
    <form
      action={async (fd) => {
        setSaving(true);
        try {
          await onSave(fd);
        } catch {
          // redirect는 여기로 오지 않는다. 검증/저장 실패만 잡힌다 — 내용은 유지된 채 알림.
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
      <div className="editor-tabs mt-4">
        <button
          type="button"
          className={`editor-tab${tab === "write" ? " editor-tab-active" : ""}`}
          onClick={() => setTab("write")}
        >
          편집
        </button>
        <button
          type="button"
          className={`editor-tab${tab === "preview" ? " editor-tab-active" : ""}`}
          onClick={() => setTab("preview")}
        >
          미리보기
        </button>
      </div>
      <div className="mt-3" onPaste={handlePaste}>
        <div className="editor-pane" style={{ display: tab === "write" ? "block" : "none" }}>
          <CodeMirror value={content} height="460px" extensions={[markdown()]} onChange={setContent} />
        </div>
        <div
          className="editor-preview prose-wiki"
          style={{ display: tab === "preview" ? "block" : "none" }}
          dangerouslySetInnerHTML={{
            __html: html || '<p style="color:var(--faint)">내용을 입력하면 미리보기가 표시됩니다.</p>',
          }}
        />
      </div>
      <p className="meta mt-2.5">
        이미지를 붙여넣으면 자동으로 업로드됩니다. [[페이지명]]으로 위키링크를 만들 수 있습니다.
      </p>
      <button disabled={saving} className="btn btn-primary mt-4">
        {saving ? "저장 중..." : "저장"}
      </button>
    </form>
  );
}
