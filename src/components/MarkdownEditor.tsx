"use client";

import { useEffect, useRef, useState } from "react";
import type { Crepe as CrepeType } from "@milkdown/crepe";
import "@milkdown/crepe/theme/common/style.css";
import "@milkdown/crepe/theme/classic.css";

type SaveResult = { conflict: true; currentVersion: number } | void;

interface Props {
  spaceKey: string;
  initialTitle: string;
  initialContent: string;
  expectedVersion?: number;
  onSave: (formData: FormData) => Promise<SaveResult>;
}

// 마크다운 직렬화 시 리터럴 대괄호가 이스케이프(\[)될 수 있다.
// 위키링크 [[페이지명]]이 깨지지 않도록 되돌린다.
function cleanMarkdown(md: string): string {
  return md.replace(/\\\[/g, "[").replace(/\\\]/g, "]");
}

// Next.js의 redirect()/notFound()는 제어 흐름을 위해 특수 에러를 throw한다.
// 저장 성공 후 redirect가 이 에러를 던지는데, 이를 catch로 삼키면 실제로는 성공인데도
// "저장 실패" 알림이 뜬다. 이 에러는 다시 던져 프레임워크가 이동을 처리하게 한다.
function isRouterControlFlowError(e: unknown): boolean {
  if (typeof e !== "object" || e === null || !("digest" in e)) return false;
  const digest = (e as { digest: unknown }).digest;
  return typeof digest === "string" && (digest.startsWith("NEXT_REDIRECT") || digest === "NEXT_NOT_FOUND");
}

export function MarkdownEditor({ spaceKey, initialTitle, initialContent, expectedVersion: initialExpectedVersion, onSave }: Props) {
  const [title, setTitle] = useState(initialTitle);
  const [content, setContent] = useState(initialContent);
  const [saving, setSaving] = useState(false);
  const [expectedVersion, setExpectedVersion] = useState(initialExpectedVersion);
  const [conflict, setConflict] = useState(false);
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
            text: "여기에 입력하세요.  '/' 로 블록 삽입",
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
          const result = await onSave(fd);
          if (result && "conflict" in result) {
            // 다른 사람이 먼저 저장함 — 최신 version으로 갱신하고 배너 표시.
            // 사용자가 다시 저장을 누르면 최신 위에 덮어쓴다(의도적 진행).
            setExpectedVersion(result.currentVersion);
            setConflict(true);
            setSaving(false);
            return;
          }
        } catch (e) {
          // redirect()/notFound()의 제어 흐름 에러는 성공 신호다. 알림 없이 넘겨서
          // 서버 주도 이동이 진행되게 한다(다시 throw하면 이동이 취소됨).
          if (isRouterControlFlowError(e)) return;
          setSaving(false);
          alert("저장에 실패했습니다. 잠시 후 다시 시도하세요.");
        }
      }}
    >
      {conflict && (
        <div className="notice notice-warn" role="alert">
          다른 사람이 이 페이지를 먼저 수정했습니다(현재 v{expectedVersion}).{" "}
          <button
            type="button"
            className="linklike"
            onClick={() => window.location.reload()}
          >
            최신 내용 불러오기
          </button>
          . 그대로 다시 저장하면 상대의 수정 위에 덮어씁니다.
        </div>
      )}
      <input
        name="title"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        required
        placeholder="제목"
        className="input input-title"
      />
      <input type="hidden" name="content" value={content} />
      <input type="hidden" name="expectedVersion" value={expectedVersion ?? ""} />
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
