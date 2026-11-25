"use client";

import { useState } from "react";
import styles from "./timeline.module.css";

export function TimelineCopyRequest({ spaceKey, from, to, canEdit }: {
  spaceKey: string; from: string; to: string; canEdit: boolean;
}) {
  const [status, setStatus] = useState<"idle" | "copied" | "manual">("idle");
  const request = [
    `위키 MCP로 ${spaceKey} 스페이스에서 ${from}부터 ${to}까지 기록된 문서 버전을 정리해 줘.`,
    `list_timeline_sources(space="${spaceKey}", from="${from}", to="${to}")로 미처리 버전을 조회하고 nextCursor가 있으면 다음 페이지도 확인해 줘.`,
    "각 버전은 get_page에 space, slug, version을 지정해 읽어 줘. 결정과 회의·논의를 구분하고 요약과 원문의 근거 문장을 save_page_timeline으로 저장해 줘.",
    "회의 날짜는 원문에 명시된 경우에만 넣고, 정리할 내용이 없는 버전은 빈 목록으로 처리해 줘.",
  ].join("\n");

  async function copy() {
    try {
      await navigator.clipboard.writeText(request);
      setStatus("copied");
    } catch {
      setStatus("manual");
    }
  }

  return (
    <div className={styles.copy}>
      <button type="button" className="btn btn-ghost btn-sm" onClick={copy}>기간 정리 요청 복사</button>
      <span role="status">
        {status === "copied" && (canEdit ? "요청을 복사했습니다. 위키 MCP 에이전트에 붙여넣으세요." : "요청을 복사했습니다. 스페이스 편집자에게 전달하세요.")}
        {status === "manual" && "아래 요청을 선택해 복사하세요."}
      </span>
      {status === "manual" && <textarea value={request} readOnly aria-label="기간 정리 요청" rows={5}
        autoFocus onFocus={event => event.currentTarget.select()} />}
    </div>
  );
}
