"use client";

import Link from "next/link";
import { WikiIcon } from "./WikiIcon";
import { useEffect, useRef, useState } from "react";
import type { Crepe as CrepeType } from "@milkdown/crepe";
import { insert } from "@milkdown/kit/utils";
import "@milkdown/crepe/theme/common/style.css";
import "@milkdown/crepe/theme/classic.css";

type SaveResult = { conflict: true; currentVersion: number } | { authRequired: true } | void;

const authDraftKey = () => `simple-wiki:auth-draft:${window.location.pathname}${window.location.search}`;

interface Props {
  spaceKey: string;
  spaceName: string;
  cancelHref: string;
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

export function MarkdownEditor({ spaceKey, spaceName, cancelHref, initialTitle, initialContent, expectedVersion: initialExpectedVersion, onSave }: Props) {
  const [title, setTitle] = useState(initialTitle);
  const [content, setContent] = useState(initialContent);
  const [saving, setSaving] = useState(false);
  const [expectedVersion, setExpectedVersion] = useState(initialExpectedVersion);
  const [conflict, setConflict] = useState(false);
  const holderRef = useRef<HTMLDivElement>(null);
  const crepeRef = useRef<CrepeType | null>(null);
  const restoredDraftRef = useRef<{ title: string; content: string; expectedVersion?: number } | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let crepe: CrepeType | null = null;
    let destroyed = false;
    let startingContent = initialContent;

    // 저장 도중 세션이 만료되어 로그인 왕복이 발생한 경우에만 임시 보관한 초안을 복원한다.
    try {
      if (!restoredDraftRef.current) {
        const key = authDraftKey();
        const raw = sessionStorage.getItem(key);
        if (raw) {
          sessionStorage.removeItem(key);
          const draft = JSON.parse(raw) as { title?: unknown; content?: unknown; expectedVersion?: unknown };
          if (typeof draft.title === "string" && typeof draft.content === "string") {
            restoredDraftRef.current = {
              title: draft.title,
              content: draft.content,
              expectedVersion: typeof draft.expectedVersion === "number" ? draft.expectedVersion : undefined,
            };
          }
        }
      }
      if (restoredDraftRef.current) {
        setTitle(restoredDraftRef.current.title);
        setContent(restoredDraftRef.current.content);
        startingContent = restoredDraftRef.current.content;
        if (restoredDraftRef.current.expectedVersion !== undefined) {
          setExpectedVersion(restoredDraftRef.current.expectedVersion);
        }
      }
    } catch {
      // 스토리지 차단이나 손상된 초안은 일반 편집 화면을 막지 않는다.
    }

    (async () => {
      const { Crepe } = await import("@milkdown/crepe");
      if (destroyed || !holderRef.current) return;

      crepe = new Crepe({
        root: holderRef.current,
        defaultValue: startingContent,
        features: {
          // 위키에는 불필요하고 '$' 입력을 가로채므로 수식은 끈다.
          [Crepe.Feature.Latex]: false,
        },
        featureConfigs: {
          [Crepe.Feature.Placeholder]: {
            text: "본문을 입력하세요. / 키로 블록을 추가할 수 있습니다.",
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

  // 파일 첨부 버튼: 순차 업로드 후 커서 위치에 링크 삽입(이미지는 인라인 이미지).
  // 실패하면 성공분 링크는 유지하고 그 파일부터 중단한다.
  async function attachFiles(files: FileList | null) {
    if (!files || files.length === 0 || !crepeRef.current) {
      // 에디터 준비 전에 고른 파일도 같은 파일로 재시도할 수 있게 초기화.
      if (fileInputRef.current) fileInputRef.current.value = "";
      return;
    }
    setUploading(true);
    try {
      for (const file of Array.from(files)) {
        const fd = new FormData();
        fd.append("file", file);
        const res = await fetch(`/api/spaces/${spaceKey}/attachments`, { method: "POST", body: fd });
        if (!res.ok) {
          alert(`파일 업로드에 실패했습니다: ${file.name}`);
          break;
        }
        const { url, filename } = (await res.json()) as { url: string; filename: string };
        // 링크 텍스트의 대괄호는 마크다운 링크 문법을 깨므로 제거한다.
        const label = filename.replace(/[[\]]/g, "");
        const md = file.type.startsWith("image/") ? `![${label}](${url})` : `[${label}](${url})`;
        // await 사이에 언마운트되면(저장 후 이동 등) cleanup이 ref를 비운다 — 남은 삽입은 중단.
        const crepe = crepeRef.current;
        if (!crepe) break;
        crepe.editor.action(insert(md));
      }
    } catch {
      // 네트워크 단절 등 fetch 자체가 거부된 경우 — HTTP 에러와 동일한 방식으로 안내.
      alert("파일 업로드에 실패했습니다. 네트워크 상태를 확인하세요.");
    } finally {
      setUploading(false);
      // 같은 파일을 연속으로 다시 선택할 수 있도록 초기화.
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  return (
    <form
      action={async (fd) => {
        // 제출 시점의 최신 마크다운을 확실히 반영한다.
        if (crepeRef.current) fd.set("content", cleanMarkdown(crepeRef.current.getMarkdown()));
        setSaving(true);
        try {
          const result = await onSave(fd);
          if (result && "authRequired" in result) {
            try {
              sessionStorage.setItem(authDraftKey(), JSON.stringify({
                title: String(fd.get("title") ?? ""),
                content: String(fd.get("content") ?? ""),
                expectedVersion,
              }));
            } catch {
              setSaving(false);
              alert("임시 저장 공간을 사용할 수 없어 로그인 화면으로 이동하지 않았습니다. 작성 내용을 복사한 뒤 다시 시도하세요.");
              return;
            }
            const callbackUrl = window.location.pathname + window.location.search;
            window.location.assign(`/login?callbackUrl=${encodeURIComponent(callbackUrl)}`);
            return;
          }
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
      <div className="document-toolbar editor-toolbar">
        <div className="document-path"><WikiIcon name="book" /><span>{spaceName}</span><span className="path-divider">/</span><strong>{initialExpectedVersion === undefined ? "새 문서" : "편집"}</strong></div>
        <div className="document-actions">
          <Link href={cancelHref} className="cancel-link">취소</Link>
          <button disabled={saving || uploading} className="btn btn-primary">{saving ? "저장 중…" : "저장"}</button>
        </div>
      </div>
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
      <div className="document-heading">
        <textarea
          name="title"
          aria-label="제목"
          placeholder="제목"
          rows={1}
          required
          value={title}
          onChange={(event) => setTitle(event.target.value.replace(/[\r\n]+/g, " "))}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.nativeEvent.isComposing) {
              event.preventDefault();
              holderRef.current?.querySelector<HTMLElement>('[contenteditable="true"]')?.focus();
            }
          }}
          className="document-title editor-title"
        />
      </div>
      <input type="hidden" name="content" value={content} />
      <input type="hidden" name="expectedVersion" value={expectedVersion ?? ""} />
      <div className="wysiwyg">
        <div ref={holderRef} />
      </div>
      <div className="editor-footer">
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          disabled={uploading}
          onClick={() => fileInputRef.current?.click()}
        >
          <WikiIcon name="attach" />{uploading ? "올리는 중…" : "파일 첨부"}
        </button>
        <p className="meta">
          이미지는 끌어다 놓고, 문서는 [[제목]]으로 연결하세요.
        </p>
      </div>
      <input ref={fileInputRef} type="file" multiple hidden onChange={(e) => attachFiles(e.target.files)} />
    </form>
  );
}
