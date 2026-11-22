"use client";

import { useEffect, useRef, useState, type MouseEvent } from "react";
import { addCodeCopyButtons } from "@/lib/code-copy";

export function WikiArticle({ html }: { html: string }) {
  const [feedback, setFeedback] = useState("");
  const article = useRef<HTMLElement>(null);

  useEffect(() => {
    if (article.current) return addCodeCopyButtons(article.current);
  }, [html]);

  async function copySectionLink(event: MouseEvent<HTMLElement>) {
    if (!(event.target instanceof Element)) return;
    const link = event.target.closest<HTMLAnchorElement>("a.section-link");
    if (!link || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    try {
      await navigator.clipboard.writeText(link.href);
      setFeedback("소제목 링크를 복사했습니다.");
    } catch {
      window.location.hash = link.hash;
      setFeedback("주소 표시줄에서 소제목 링크를 복사하세요.");
    }
  }

  return (
    <>
      <article ref={article} className="prose-wiki" onClick={copySectionLink} dangerouslySetInnerHTML={{ __html: html }} />
      <p className={feedback ? "copy-feedback" : "sr-only"} role="status"
        onAnimationEnd={() => setFeedback("")}>{feedback}</p>
    </>
  );
}
