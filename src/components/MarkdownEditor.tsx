"use client";

import { useEffect, useRef, useState } from "react";
import type { Crepe as CrepeType } from "@milkdown/crepe";
import "@milkdown/crepe/theme/common/style.css";
import "@milkdown/crepe/theme/classic.css";

interface Props {
  spaceKey: string;
  initialTitle: string;
  initialContent: string;
  onSave: (formData: FormData) => Promise<void>;
}

// 마크다운 직렬화 시 리터럴 대괄호가 이스케이프(\[)될 수 있다.
// 위키링크 [[페이지명]]이 깨지지 않도록 되돌린다.
function cleanMarkdown(md: string): string {
  return md.replace(/\\\[/g, "[").replace(/\\\]/g, "]");
}

export function MarkdownEditor({ spaceKey, initialTitle, initialContent, onSave }: Props) {
  const [title, setTitle] = useState(initialTitle);
  const [content, setContent] = useState(initialContent);
  const [saving, setSaving] = useState(false);
  const holderRef = useRef<HTMLDivElement>(null);
  const crepeRef = useRef<CrepeType | null>(null);

  useEffect(() => {
    let crepe: CrepeType | null = null;
    let destroyed = false;

    (async () => {
      const { Crepe } = await import("@milkdown/crepe");
      if (destroyed || !holderRef.current) return;

      crepe = new Crepe({
        root: holderRef.current,
        defaultValue: initialContent,
        features: {
          // 위키에는 불필요하고 '$' 입력을 가로채므로 수식은 끈다.
          [Crepe.Feature.Latex]: false,
        },
        featureConfigs: {
          [Crepe.Feature.Placeholder]: {
            text: "여기에 입력하세요. '/' 를 누르면 블록을 삽입할 수 있고, '# '·'- '처럼 마크다운을 치면 바로 렌더링됩니다.",
            mode: "block",
          },
          [Crepe.Feature.ImageBlock]: {
            onUpload: async (file: File): Promise<string> => {
              const fd = new FormData();
              fd.append("file", file);
              const res = await fetch(`/api/spaces/${spaceKey}/attachments`, {
                method: "POST",
                body: fd,
              });
              if (!res.ok) throw new Error("upload failed");
              const { url } = (await res.json()) as { url: string };
              return url;
            },
          },
        },
      });

      await crepe.create();
      if (destroyed) {
        crepe.destroy();
        return;
      }
      crepe.on((api) => {
        api.markdownUpdated((_ctx, markdown) => {
          setContent(cleanMarkdown(markdown));
        });
      });
      crepeRef.current = crepe;
    })();

    return () => {
      destroyed = true;
      crepe?.destroy();
      crepeRef.current = null;
    };
    // 마운트 시 한 번만 생성한다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <form
      action={async (fd) => {
        // 제출 시점의 최신 마크다운을 확실히 반영한다.
        if (crepeRef.current) fd.set("content", cleanMarkdown(crepeRef.current.getMarkdown()));
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
      <div className="wysiwyg mt-4">
        <div ref={holderRef} />
      </div>
      <p className="meta mt-2.5">
        이미지를 붙여넣거나 끌어다 올릴 수 있습니다. [[페이지명]]으로 위키링크를 만들 수 있습니다.
      </p>
      <button disabled={saving} className="btn btn-primary mt-4">
        {saving ? "저장 중..." : "저장"}
      </button>
    </form>
  );
}
