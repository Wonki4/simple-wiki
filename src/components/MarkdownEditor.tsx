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
import { MarkdownPreview } from "./MarkdownPreview";
import type { UploadedAttachment } from "@/lib/attachment-upload";
import { useAttachmentUploads } from "./useAttachmentUploads";
import { WikiIcon } from "./WikiIcon";
import { MarkdownModeSwitch } from "./MarkdownModeSwitch";
import { WikiLinkCompletion } from "./WikiLinkCompletion";
import { blockLinkTarget, sourceLinkTarget } from "@/lib/editor-link-target";
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
  const [showPreview, setShowPreview] = useState(false);
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
  const { upload, retry, dismiss, failures, retrying, uploadPending } = useAttachmentUploads(spaceKey);
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

  function readLinkTarget() {
    if (saving || uploadPending) return null;
    if (showSource) return textareaRef.current && sourceLinkTarget(textareaRef.current, editSource);
    return crepeRef.current?.editor.action(ctx => blockLinkTarget(ctx.get(editorViewCtx))) ?? null;
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
            // 블록 모드에서는 Milkdown이 원래 이미지의 주소를 설정한다.
            onUpload: (file: File) => new Promise<string>(resolve => {
              void upload(file, attachment => {
                if (draftRef.current.mode === "source") {
                  insertAttachment(file, attachment);
                  resolve("");
                } else {
                  resolve(attachment.url);
                }
              }, () => resolve("")).then(result => {
                if (result) resolve(result.url);
              });
            }),
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
        async uploader(files, schema) {
          const images = Array.from(files).filter(file => file.type.startsWith("image/"));
          const nodes = await Promise.all(images.map(async file => {
            const result = await upload(file, attachment => insertAttachment(file, attachment));
            return result && schema.nodes["image-block"].create({ src: result.url });
          }));
          // 성공한 이미지만 원래 붙여넣기·드롭 위치에 삽입하고 진행 표시를 정리한다.
          return nodes.filter(node => node !== undefined);
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

  function insertAttachment(file: File, { url, filename }: UploadedAttachment) {
    const label = filename.replace(/[[\]]/g, "");
    const markdown = file.type.startsWith("image/") ? `![${label}](${url})` : `[${label}](${url})`;
    if (draftRef.current.mode === "source") {
      const input = textareaRef.current;
      if (!input) return;
      input.setRangeText(markdown, input.selectionStart, input.selectionEnd, "end");
      editSource(input.value);
      input.focus();
    } else {
      crepeRef.current?.editor.action(insert(markdown));
    }
  }

  async function attachFiles(input: HTMLInputElement) {
    const files = Array.from(input.files ?? []);
    input.value = "";
    for (const file of files) {
      const insertFile = (attachment: UploadedAttachment) => insertAttachment(file, attachment);
      const result = await upload(file, insertFile);
      if (result) insertFile(result);
    }
  }

  const canEdit = draftLoaded && (showSource || ready);
  return (
    <form className={showSource && showPreview ? "editor-with-preview" : undefined}
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
        {showSource && <button type="button" className="btn btn-ghost btn-sm"
          aria-expanded={showPreview} aria-controls={showPreview ? "source-preview" : undefined}
          onClick={() => setShowPreview(open => !open)}>
          {showPreview ? "미리보기 닫기" : "미리보기 열기"}
        </button>}
      </div>
      <WikiLinkCompletion readTarget={readLinkTarget}>
        {showSource && <textarea ref={textareaRef} aria-label="마크다운 원문" className="markdown-source source-input"
          value={sourceText} onChange={event => editSource(event.target.value)} readOnly={saving || uploadPending}
          placeholder="마크다운 원문을 입력하세요." spellCheck={false} />}
        <div className="wysiwyg" hidden={showSource}>
          <div ref={holderRef} />
        </div>
      </WikiLinkCompletion>
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
          {showSource ? "파일을 첨부하면 커서 위치에 마크다운 링크가 들어갑니다." : "이미지는 끌어다 놓고, 문서는 [[제목]]으로 연결하세요."}
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
      <input ref={fileInputRef} type="file" multiple hidden onChange={(e) => attachFiles(e.currentTarget)} />
      {showSource && showPreview && <MarkdownPreview id="source-preview" spaceKey={spaceKey} content={sourceText} />}
    </form>
  );
}
