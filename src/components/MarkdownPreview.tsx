"use client";

import { useEffect, useState } from "react";

type PreviewResult = { content: string } & ({ html: string } | { error: string });

export function MarkdownPreview({ id, spaceKey, content }: { id: string; spaceKey: string; content: string }) {
  const [result, setResult] = useState<PreviewResult | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!content.trim()) {
      setResult(null);
      return;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      try {
        const response = await fetch(`/api/spaces/${encodeURIComponent(spaceKey)}/preview`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ content }),
          signal: controller.signal,
        });
        if (!response.ok) {
          let error = "미리보기를 불러오지 못했습니다.";
          if (response.status === 401) error = "로그인 세션이 만료되었습니다.";
          if (response.status === 403 || response.status === 404) error = "이 스페이스의 편집 권한을 확인하세요.";
          if (!controller.signal.aborted) setResult({ content, error });
          return;
        }
        const { html } = await response.json();
        if (typeof html !== "string") throw new Error("미리보기를 불러오지 못했습니다.");
        if (!controller.signal.aborted) setResult({ content, html });
      } catch {
        if (!controller.signal.aborted) setResult({ content, error: "미리보기를 불러오지 못했습니다." });
      }
    }, 350);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [spaceKey, content, attempt]);

  const empty = !content.trim();
  const busy = !empty && result?.content !== content;
  const error = !empty && !busy && result && "error" in result ? result.error : null;
  return (
    <section id={id} aria-label="본문 미리보기" className="source-preview">
      <div className="source-preview-heading">
        <h2>미리보기</h2>
        <span className="meta" role="status">{busy ? "갱신 중…" : ""}</span>
      </div>
      {empty && <p className="meta">미리 볼 본문이 없습니다.</p>}
      {error && <div className="notice notice-warn" role="alert">
        {error}{" "}
        <button type="button" className="linklike" onClick={() => {
          setResult(null);
          setAttempt(n => n + 1);
        }}>다시 시도</button>
      </div>}
      {!empty && result && "html" in result &&
        <article className="prose-wiki" aria-busy={busy} dangerouslySetInnerHTML={{ __html: result.html }} />}
    </section>
  );
}
