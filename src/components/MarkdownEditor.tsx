"use client";

import { NavigationLink as Link } from "./NavigationLink";
import { useRouter } from "next/navigation";
import type { EditorView } from "@codemirror/view";
import { uploadAnchor } from "@/lib/live-editor";
import { readDraft, storeDraft, type PageDraft } from "@/lib/editor-draft";
import { applySourceEdit } from "@/lib/source-edit";
import type { SaveResult } from "@/actions/pages";
import { LiveMarkdownEditor } from "./LiveMarkdownEditor";
import { useEditorWikiLinks } from "./useEditorWikiLinks";
import { useAttachmentUploads } from "./useAttachmentUploads";
import { WikiIcon } from "./WikiIcon";
import { WikiLinkCompletion } from "./WikiLinkCompletion";
import { liveLinkTarget } from "@/lib/editor-link-target";
import { useEffect, useRef, useState } from "react";

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
  const [sourceText, setSourceText] = useState(initialContent.replace(/\r\n?/g, "\n"));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [conflictVersion, setConflictVersion] = useState<number>();
  const [restored, setRestored] = useState(false);
  const [storageFailed, setStorageFailed] = useState(false);
  const viewRef = useRef<EditorView | null>(null);
  const draftRef = useRef<PageDraft>({ title: initialTitle, content: initialContent, expectedVersion });
  const discardedRef = useRef(false);
  const { upload, retry, dismiss, failures, retrying, uploadPending } = useAttachmentUploads(spaceKey);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const wikiOptions = useEditorWikiLinks(spaceKey, sourceText);

  function persistDraft() {
    if (discardedRef.current) return;
    const draft = draftRef.current;
    const changed = draft.title !== initialTitle || draft.content !== initialContent;
    setStorageFailed(!storeDraft(draftKey, changed ? draft : null));
  }

  function discardDraft() {
    discardedRef.current = true;
    storeDraft(draftKey, null);
  }

  function contentChanged(value: string) {
    draftRef.current.content = applySourceEdit(draftRef.current.content, value);
    setSourceText(value);
    persistDraft();
  }

  function readLinkTarget() {
    if (saving || uploadPending) return null;
    return viewRef.current ? liveLinkTarget(viewRef.current) : null;
  }

  useEffect(() => {
    const stored = readDraft(draftKey);
    if (stored) {
      draftRef.current = stored;
      setTitle(stored.title);
      setSourceText(stored.content.replace(/\r\n?/g, "\n"));
      setRestored(true);
    }
    setDraftLoaded(true);
    window.addEventListener("pagehide", persistDraft);
    return () => { window.removeEventListener("pagehide", persistDraft); persistDraft(); };
    // The parent remounts this editor when the document or draft target changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function attachFiles(files: File[]) {
    const view = viewRef.current;
    if (!view || saving || uploadPending) return;
    const { from, to } = view.state.selection.main;
    const uploads = files.map(file => ({ file, anchor: uploadAnchor(view, from, to) }));
    for (const { file, anchor } of uploads) {
      const insert = ({ url, filename }: { url: string; filename: string }) => {
        if (viewRef.current !== view) return;
        const label = filename.replace(/[[\]]/g, "");
        const image = file.type.startsWith("image/");
        const markdown = image ? `![${label}](${url})` : `[${label}](${url})`;
        anchor.insert(image ? markdown + "\n\n" : markdown);
      };
      const result = await upload(file, insert, () => { if (viewRef.current === view) anchor.discard(); });
      if (result) insert(result);
    }
  }

  const canEdit = draftLoaded && ready;
  return (
    <form
      onSubmit={async (event) => {
        event.preventDefault();
        if (!canEdit || saving || uploadPending) return;
        setSaving(true);
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
      {storageFailed && <div className="notice notice-warn" role="alert">초안을 이 탭에 보관할 수 없습니다. 이동하기 전에 내용을 복사하세요.</div>}
      {restored && <p className="meta" role="status">이 탭에 보관한 초안을 복원했습니다.</p>}
      {conflictVersion !== undefined && (
        <div className="notice notice-warn" role="alert">
          다른 사람이 이 페이지를 먼저 수정했습니다(현재 v{conflictVersion}).{" "}
          <a className="linklike" href={`${cancelHref}/history?from=${draftRef.current.expectedVersion}&to=${conflictVersion}`}
            target="_blank" rel="noopener noreferrer">저장된 버전 비교</a>{" · "}
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
              viewRef.current?.focus();
            }
          }}
          className="document-title editor-title"
        />
      </div>
      <div className="editor-content">
        <WikiLinkCompletion spaceKey={spaceKey} readTarget={readLinkTarget} readMarkdown={() => draftRef.current.content}>
          <div className={`live-editor${uploadPending ? " is-uploading" : ""}`}>
            {!ready && <p className="editor-loading" role="status">편집기를 준비하는 중…</p>}
            {draftLoaded && <LiveMarkdownEditor initialContent={draftRef.current.content} options={wikiOptions}
              viewRef={viewRef} readOnly={saving || uploadPending} onChange={contentChanged}
              onReady={() => setReady(true)} onFiles={files => { void attachFiles(files); }} />}
          </div>
          {uploadPending && <p className="editor-upload-status" role="status">파일 올리는 중…</p>}
        </WikiLinkCompletion>
      </div>
      <div className="editor-footer">
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          disabled={!canEdit || saving || uploadPending}
          onClick={() => fileInputRef.current?.click()}
        >
          <WikiIcon name="attach" />{uploadPending ? "올리는 중…" : "파일 첨부"}
        </button>
        <p className="meta">
          클릭한 줄은 원문으로 편집합니다. [[ 로 문서를 연결하세요.
        </p>
        {failures.length > 0 && (
          <ul className="upload-failures" aria-label="업로드 실패 목록">
            {failures.map(failure => (
              <li key={failure.id} className="notice notice-warn">
                <div role="alert"><strong>{failure.file.name}</strong> · {failure.reason}</div>
                <div className="upload-failure-actions">
                  <button type="button" className="btn btn-ghost btn-sm" disabled={saving || uploadPending}
                    onClick={() => retry(failure)}>
                    {retrying === failure.id ? "다시 올리는 중…" : "다시 시도"}
                  </button>
                  <button type="button" className="btn btn-ghost btn-sm" disabled={saving || retrying === failure.id}
                    onClick={() => dismiss(failure)}>목록에서 제거</button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
      <input ref={fileInputRef} type="file" multiple hidden onChange={event => {
        const files = Array.from(event.currentTarget.files ?? []);
        event.currentTarget.value = "";
        void attachFiles(files);
      }} />
    </form>
  );
}
