"use client";

import Link, { useLinkStatus } from "next/link";
import { createPortal } from "react-dom";
import type { ComponentProps } from "react";

function NavigationFeedback() {
  const { pending } = useLinkStatus();
  if (!pending) return null;

  // 모바일 탐색이 닫혀도 이동 상태는 보이도록 링크 바깥에 표시한다.
  // 링크의 크기나 이름은 바꾸지 않아 클릭 중 버튼이 밀리지 않는다.
  return createPortal(
    <div className="navigation-feedback" role="status">
      <span className="navigation-feedback__bar" aria-hidden="true" />
      <span className="navigation-feedback__label">페이지를 불러오는 중…</span>
    </div>,
    document.body,
  );
}

export function NavigationLink({ children, ...props }: ComponentProps<typeof Link>) {
  return <Link {...props}>{children}<NavigationFeedback /></Link>;
}
