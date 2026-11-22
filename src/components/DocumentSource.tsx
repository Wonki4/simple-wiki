"use client";

import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { WikiIcon } from "./WikiIcon";

export function DocumentSource({ source, title }: { source: string; title: string }) {
  const [open, setOpen] = useState(false);
  const [copying, setCopying] = useState(false);
  const [feedback, setFeedback] = useState("");
  const dialog = useRef<HTMLDialogElement>(null);
  const returnTo = useRef<HTMLElement | null>(null);
  const headingId = useId();

  useEffect(() => { if (open) dialog.current?.showModal(); }, [open]);

  return <>
    <button type="button" className="menu-item" onClick={event => {
      const menu = event.currentTarget.closest("details");
      returnTo.current = menu?.querySelector("summary") ?? event.currentTarget;
      if (menu) menu.open = false;
      setOpen(true);
    }}>원문 보기</button>
    {open && createPortal(
      <dialog ref={dialog} className="source-dialog" aria-labelledby={headingId} onClose={() => {
        setOpen(false);
        setCopying(false);
        setFeedback("");
        if (returnTo.current?.isConnected) returnTo.current.focus();
      }}>
        <header className="source-dialog__header">
          <div><h2 id={headingId}>마크다운 원문</h2><p className="meta">{title}</p></div>
          <button type="button" className="icon-button" aria-label="원문 닫기" autoFocus
            onClick={() => dialog.current?.close()}><WikiIcon name="close" /></button>
        </header>
        <pre className="markdown-source" aria-label="마크다운 원문" tabIndex={0}><code>{source}</code></pre>
        <footer className="source-dialog__footer">
          <p className="meta" role="status">{feedback}</p>
          <button type="button" className="btn btn-ghost btn-sm" disabled={copying} onClick={async () => {
            const current = dialog.current;
            setCopying(true);
            setFeedback("");
            try {
              await navigator.clipboard.writeText(source);
              if (current?.open) setFeedback("원문을 복사했습니다.");
            } catch {
              if (current?.open) setFeedback("원문을 선택해 직접 복사하세요.");
            } finally { if (current?.open) setCopying(false); }
          }}>원문 복사</button>
        </footer>
      </dialog>, document.body,
    )}
  </>;
}
