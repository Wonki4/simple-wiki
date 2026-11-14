"use client";

import { useState, type MouseEvent } from "react";
import type { Section } from "@/lib/reading-markup";
import { MarkdownModeSwitch } from "./MarkdownModeSwitch";

export function WikiArticle({ html, sections, source }: { html: string; sections: Section[]; source: string }) {
  const [showSource, setShowSource] = useState(false);
  const [feedback, setFeedback] = useState("");
  const topDepth = sections.reduce((depth, section) => Math.min(depth, section.depth), 6);

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
      <div className="markdown-tools">
        <MarkdownModeSwitch source={showSource} onChange={setShowSource} />
        {showSource && <button type="button" className="btn btn-ghost btn-sm" onClick={async () => {
          try {
            await navigator.clipboard.writeText(source);
            setFeedback("원문을 복사했습니다.");
          } catch {
            setFeedback("원문을 선택해 직접 복사하세요.");
          }
        }}>원문 복사</button>}
      </div>
      {!showSource && sections.length > 1 && (
        <nav aria-label="문서 목차" className="article-toc">
          <details>
            <summary>목차 <span>{sections.length}</span></summary>
            <ul>
              {sections.map(({ id, title, depth }) => (
                <li key={id} style={{ paddingInlineStart: `${(depth - topDepth) * 0.8}rem` }}>
                  <a href={`#${id}`}>{title}</a>
                </li>
              ))}
            </ul>
          </details>
        </nav>
      )}
      {showSource
        ? <pre className="markdown-source" aria-label="마크다운 원문"><code>{source}</code></pre>
        : <article className="prose-wiki" onClick={copySectionLink} dangerouslySetInnerHTML={{ __html: html }} />}
      <p className={feedback ? "copy-feedback" : "sr-only"} role="status"
        onAnimationEnd={() => setFeedback("")}>{feedback}</p>
    </>
  );
}
