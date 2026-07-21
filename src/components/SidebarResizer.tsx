"use client";

import { useEffect } from "react";

const KEY = "lnb-width";
const MIN = 180;
const MAX = 480;

function apply(px: number | null) {
  const root = document.documentElement;
  if (px === null) root.style.removeProperty("--lnb-w");
  else root.style.setProperty("--lnb-w", `${px}px`);
}

// LNB 우측 경계의 드래그 핸들. 드래그로 너비 조절, 더블클릭으로 기본값 복원.
// 너비는 localStorage에 저장해 다음 방문에도 유지한다.
export function SidebarResizer() {
  useEffect(() => {
    const saved = Number(localStorage.getItem(KEY));
    if (saved >= MIN && saved <= MAX) apply(saved);
  }, []);

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    const lnb = e.currentTarget.parentElement;
    if (!lnb) return;
    const handle = e.currentTarget;
    const startX = e.clientX;
    const startW = lnb.getBoundingClientRect().width;
    let width = startW;
    // 캡처로 핸들 밖으로 나가도 move/up을 계속 받는다.
    try {
      handle.setPointerCapture(e.pointerId);
    } catch {
      /* 합성 이벤트 등 pointerId가 유효하지 않으면 캡처 없이 진행 */
    }
    const onMove = (ev: PointerEvent) => {
      width = Math.round(Math.min(MAX, Math.max(MIN, startW + ev.clientX - startX)));
      apply(width);
    };
    const onUp = () => {
      handle.removeEventListener("pointermove", onMove);
      handle.removeEventListener("pointerup", onUp);
      try {
        localStorage.setItem(KEY, String(width));
      } catch {
        /* 프라이빗 모드 등 저장 실패는 무시 */
      }
    };
    handle.addEventListener("pointermove", onMove);
    handle.addEventListener("pointerup", onUp);
  };

  const onDoubleClick = () => {
    apply(null);
    try {
      localStorage.removeItem(KEY);
    } catch {
      /* 저장소 접근 실패 무시 */
    }
  };

  return (
    <div
      className="lnb__resizer"
      role="separator"
      aria-orientation="vertical"
      aria-label="사이드바 너비 조절"
      title="드래그로 너비 조절 · 더블클릭 초기화"
      onPointerDown={onPointerDown}
      onDoubleClick={onDoubleClick}
    />
  );
}
