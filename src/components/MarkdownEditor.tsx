"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { editorViewCtx, serializerCtx } from "@milkdown/kit/core";
import { uploadConfig } from "@milkdown/kit/plugin/upload";
import { Decoration } from "@milkdown/kit/prose/view";
import { configureWikiLinkMarkdown } from "@/lib/editor-markdown";
import { readDraft, storeDraft, type LocalDraft, type PageDraft } from "@/lib/editor-draft";
import { applySourceEdit } from "@/lib/source-edit";
import type { SaveResult } from "@/actions/pages";
import { WikiIcon } from "./WikiIcon";
import { MarkdownModeSwitch } from "./MarkdownModeSwitch";
import { useEffect, useRef, useState } from "react";
import type { Crepe as CrepeType } from "@milkdown/crepe";
import { insert, replaceAll } from "@milkdown/kit/utils";
import "@milkdown/crepe/theme/common/style.css";
import "@milkdown/crepe/theme/classic.css";

interface Props {
  draftKey: string;
  spaceKey: string;
  spaceName: string;
  cancelHref: string;
  initialTitle: string;
  initialContent: string;
  expectedVersion?: number;
  onSave: (draft: PageDraft) => Promise<SaveResult>;
}

export function MarkdownEditor({ draftKey, spaceKey, spaceName, cancelHref, initialTitle, initialContent, expectedVersion, onSave }: Props) {
  const router = useRouter();
  const [title, setTitle] = useState(initialTitle);
  const [ready, setReady] = useState(false);
  const [draftLoaded, setDraftLoaded] = useState(false);
  const [showSource, setShowSource] = useState(false);
  const [sourceText, setSourceText] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [conflictVersion, setConflictVersion] = useState<number>();
  const [restored, setRestored] = useState(false);
  const [storageFailed, setStorageFailed] = useState(false);
  const holderRef = useRef<HTMLDivElement>(null);
  const crepeRef = useRef<CrepeType | null>(null);
  const draftRef = useRef<LocalDraft>({ title: initialTitle, content: initialContent, expectedVersion });
  const readContentRef = useRef<(() => string) | null>(null);
  const loadContentRef = useRef<((source: string) => void) | null>(null);
  const discardedRef = useRef(false);
  const [uploading, setUploading] = useState(false);
  const [pendingImageBatches, setPendingImageBatches] = useState(0);
  const [imageUploadError, setImageUploadError] = useState("");
  const uploadPending = uploading || pendingImageBatches > 0;
  const fileInputRef = useRef<HTMLInputElement>(null);

  function persistDraft() {
    if (discardedRef.current) return;
    const draft = draftRef.current;
    if (draft.mode !== "source" && readContentRef.current) draft.content = readContentRef.current();
    const changed = draft.title !== initialTitle || draft.content !== initialContent;
    setStorageFailed(!storeDraft(draftKey, changed ? draft : null));
  }

  function discardDraft() {
    discardedRef.current = true;
    storeDraft(draftKey, null);
  }

  function changeMode(source: boolean) {
    const draft = draftRef.current;
    if (source === (draft.mode === "source")) return;
    if (source) {
      draft.content = readContentRef.current?.() ?? draft.content;
      setSourceText(draft.content.replace(/\r\n?/g, "\n"));
    } else {
      if (!loadContentRef.current) return;
      try { loadContentRef.current(draft.content); }
      catch {
        setError("이 원문을 블록으로 표시할 수 없습니다. 원문에서 계속 편집할 수 있습니다.");
        return;
      }
    }
    draft.mode = source ? "source" : "block";
    setShowSource(source);
    persistDraft();
  }

  function editSource(value: string) {
    draftRef.current.content = applySourceEdit(draftRef.current.content, value);
    setSourceText(value);
    persistDraft();
  }

  useEffect(() => {
    let destroyed = false;
    const stored = readDraft(draftKey);
    if (stored) {
      draftRef.current = stored;
      setTitle(stored.title);
      setRestored(true);
      if (stored.mode === "source") {
        setSourceText(stored.content.replace(/\r\n?/g, "\n"));
        setShowSource(true);
      }
    }
    setDraftLoaded(true);
    const startingContent = draftRef.current.content;
    window.addEventListener("pagehide", persistDraft);

    (async () => {
      const { Crepe } = await import("@milkdown/crepe");
      if (destroyed || !holderRef.current) return;

      const crepe = new Crepe({
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

      crepe.editor.config(configureWikiLinkMarkdown);
      crepe.editor.config(ctx => ctx.update(uploadConfig.key, config => ({
        ...config,
        uploadWidgetFactory(pos, spec) {
          const status = document.createElement("span");
          status.className = "editor-upload-status";
          status.setAttribute("role", "status");
          status.textContent = "이미지 올리는 중…";
          return Decoration.widget(pos, status, spec);
        },
        async uploader(...args) {
          setImageUploadError("");
          setPendingImageBatches(n => n + 1);
          try {
            return await config.uploader(...args);
          } catch {
            if (!destroyed) setImageUploadError("이미지를 올리지 못했습니다. 다시 시도해 주세요.");
            // Milkdown removes this batch's widget on resolution only.
            return [];
          } finally {
            if (!destroyed) setPendingImageBatches(n => n - 1);
          }
        },
      })));
      await crepe.create();
      if (destroyed) {
        crepe.destroy();
        return;
      }

      const editor = crepe.editor;
      let openingDoc = editor.action(ctx => ctx.get(editorViewCtx).state.doc);
      let openingSource = startingContent;
      // 제목만 변경하거나 본문 편집을 되돌렸다면 공백·개행까지 원문 그대로 저장한다.
      let lastDoc = openingDoc;
      let lastSource = startingContent;
      readContentRef.current = () => editor.action(ctx => {
        const doc = ctx.get(editorViewCtx).state.doc;
        if (doc !== lastDoc) {
          lastSource = doc.eq(openingDoc) ? openingSource : ctx.get(serializerCtx)(doc);
          lastDoc = doc;
        }
        return lastSource;
      });
      loadContentRef.current = (source) => {
        if (source === readContentRef.current?.()) return;
        editor.action(replaceAll(source, true));
        openingDoc = lastDoc = editor.action(ctx => ctx.get(editorViewCtx).state.doc);
        openingSource = lastSource = source;
      };
      crepe.on(api => api.updated(persistDraft));
      crepeRef.current = crepe;
      setReady(true);
    })().catch(() => {
      if (destroyed) return;
      changeMode(true);
      setError("블록 편집기를 열 수 없어 원문 편집기로 전환했습니다.");
    });

    return () => {
      destroyed = true;
      window.removeEventListener("pagehide", persistDraft);
      persistDraft();
      readContentRef.current = null;
      loadContentRef.current = null;
      crepeRef.current?.destroy();
      crepeRef.current = null;
    };
    // 문서 또는 새 문서의 대상이 바뀌면 부모가 draftKey로 다시 마운트한다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 파일 첨부 버튼: 순차 업로드 후 커서 위치에 링크 삽입(이미지는 인라인 이미지).
  // 실패하면 성공분 링크는 유지하고 그 파일부터 중단한다.
  async function attachFiles(files: FileList | null) {
    if (!files || files.length === 0 || (!crepeRef.current && !textareaRef.current)) {
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
        if (draftRef.current.mode === "source") {
          const input = textareaRef.current;
          if (!input) break;
          input.setRangeText(md, input.selectionStart, input.selectionEnd, "end");
          editSource(input.value);
          input.focus();
        } else {
          const crepe = crepeRef.current;
          if (!crepe) break;
          crepe.editor.action(insert(md));
        }
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

  const canEdit = draftLoaded && (showSource || ready);
  return (
    <form
      onSubmit={async (event) => {
        event.preventDefault();
        const editor = crepeRef.current;
        if (!canEdit || saving || uploadPending) return;
        setSaving(true);
        editor?.setReadonly(true);
        setError("");
        persistDraft();
        const draft = { ...draftRef.current };
        try {
          const result = await onSave({ title: draft.title, content: draft.content, expectedVersion: conflictVersion ?? draft.expectedVersion });
          if ("savedHref" in result) {
            discardDraft();
            router.push(result.savedHref);
            return;
          }
          if ("authRequired" in result) {
            if (storeDraft(draftKey, draft)) {
              const callbackUrl = window.location.pathname + window.location.search;
              window.location.assign(`/login?callbackUrl=${encodeURIComponent(callbackUrl)}`);
              return;
            }
            setError("임시 저장 공간을 사용할 수 없습니다. 작성 내용을 복사한 뒤 다시 로그인하세요.");
          } else if ("conflict" in result) {
            setConflictVersion(result.currentVersion);
          } else {
            setError(result.error);
          }
        } catch {
          setError("저장에 실패했습니다. 잠시 후 다시 시도하세요.");
        }
        crepeRef.current?.setReadonly(false);
        setSaving(false);
      }}
    >
      <div className="document-toolbar editor-toolbar">
        <div className="document-path"><WikiIcon name="book" /><span>{spaceName}</span><span className="path-divider">/</span><strong>{expectedVersion === undefined ? "새 문서" : "편집"}</strong></div>
        <div className="document-actions">
          <Link
            href={cancelHref}
            className="cancel-link"
            onNavigate={(event) => {
              if (saving) event.preventDefault();
              else discardDraft();
            }}
          >취소</Link>
          <button disabled={!canEdit || saving || uploadPending} className="btn btn-primary">{saving ? "저장 중…" : "저장"}</button>
        </div>
      </div>
      {error && <div className="notice notice-warn" role="alert">{error}</div>}
      {imageUploadError && <div className="notice notice-warn" role="alert">{imageUploadError}</div>}
      {storageFailed && <div className="notice notice-warn" role="alert">초안을 이 탭에 보관할 수 없습니다. 이동하기 전에 내용을 복사하세요.</div>}
      {restored && <p className="meta" role="status">이 탭에 보관한 초안을 복원했습니다.</p>}
      {conflictVersion !== undefined && (
        <div className="notice notice-warn" role="alert">
          다른 사람이 이 페이지를 먼저 수정했습니다(현재 v{conflictVersion}).{" "}
          <button
            type="button"
            className="linklike"
            onClick={() => { discardDraft(); window.location.reload(); }}
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
          disabled={saving || !canEdit}
          onChange={(event) => {
            const value = event.target.value.replace(/[\r\n]+/g, " ");
            draftRef.current.title = value;
            setTitle(value);
            persistDraft();
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.nativeEvent.isComposing) {
              event.preventDefault();
              if (showSource) textareaRef.current?.focus();
              else holderRef.current?.querySelector<HTMLElement>('[contenteditable="true"]')?.focus();
            }
          }}
          className="document-title editor-title"
        />
      </div>
      <div className="markdown-tools">
        <MarkdownModeSwitch editing source={showSource} onChange={changeMode}
          disabled={!draftLoaded || saving || uploadPending} disableFormatted={!ready} />
      </div>
      {showSource && <textarea ref={textareaRef} aria-label="마크다운 원문" className="markdown-source source-input"
        value={sourceText} onChange={event => editSource(event.target.value)} readOnly={saving || uploading}
        placeholder="마크다운 원문을 입력하세요." spellCheck={false} />}
      <div className="wysiwyg" hidden={showSource}>
        <div ref={holderRef} />
      </div>
      <div className="editor-footer">
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          disabled={!canEdit || saving || uploadPending}
          onClick={() => fileInputRef.current?.click()}
        >
          <WikiIcon name="attach" />{uploading ? "올리는 중…" : "파일 첨부"}
        </button>
        <p className="meta">
          {showSource ? "파일을 첨부하면 커서 위치에 마크다운 링크가 들어갑니다." : "이미지는 끌어다 놓고, 문서는 [[제목]]으로 연결하세요."}
        </p>
      </div>
      <input ref={fileInputRef} type="file" multiple hidden onChange={(e) => attachFiles(e.target.files)} />
    </form>
  );
}
