"use client";

import { useRef, useState } from "react";
import styles from "./preview.module.css";

export function HtmlRequestExample({ documentPath }: { documentPath: string }) {
  const example = useRef<HTMLQuoteElement>(null);
  const [feedback, setFeedback] = useState("");

  async function copyRequest() {
    const quote = example.current;
    if (!quote) return;
    setFeedback("");
    try {
      await navigator.clipboard.writeText(quote.textContent);
      setFeedback("요청을 복사했습니다.");
    } catch {
      window.getSelection()?.selectAllChildren(quote);
      setFeedback("요청 예시를 직접 복사해 주세요.");
    }
  }

  return <>
    <div className={styles.requestExample}>
      <blockquote ref={example}>
        위키 문서 <code>{documentPath}</code>의 내용을 HTML로 정리하고 <code>save_page_html</code>로 저장해 줘.
      </blockquote>
      <button type="button" className="btn btn-ghost btn-sm" onClick={copyRequest}>요청 복사</button>
    </div>
    <span className={styles.copyStatus} role="status">{feedback}</span>
  </>;
}
