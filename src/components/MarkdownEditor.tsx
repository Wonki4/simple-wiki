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
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      preview(content).then(setHtml).catch(() => setHtml("<p>미리보기 실패</p>"));
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
        className="w-full rounded border border-gray-300 px-3 py-2 text-lg font-semibold"
      />
      <input type="hidden" name="content" value={content} />
      <div className="mt-4 grid grid-cols-2 gap-4" onPaste={handlePaste}>
        <div className="min-h-[400px] overflow-hidden rounded border border-gray-300">
          <CodeMirror value={content} height="400px" extensions={[markdown()]} onChange={setContent} />
        </div>
        <div className="prose-wiki min-h-[400px] overflow-auto rounded border border-gray-100 bg-gray-50 p-4"
          dangerouslySetInnerHTML={{ __html: html }}
        />
      </div>
      <p className="mt-2 text-xs text-gray-400">이미지를 붙여넣으면 자동으로 업로드됩니다. [[페이지명]]으로 위키링크를 만들 수 있습니다.</p>
      <button disabled={saving} className="mt-4 rounded bg-blue-600 px-4 py-2 text-sm text-white disabled:opacity-50">
        {saving ? "저장 중..." : "저장"}
      </button>
    </form>
  );
}
