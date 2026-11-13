"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { WikiIcon } from "./WikiIcon";

export function SidebarFrame({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLElement>(null);
  const pathname = usePathname();

  useEffect(() => {
    const nav = ref.current!;
    const mobile = window.matchMedia("(max-width: 860px)");
    function sync() {
      if (mobile.matches) nav.setAttribute("popover", "auto");
      else nav.removeAttribute("popover");
    }
    sync();
    mobile.addEventListener("change", sync);
    return () => mobile.removeEventListener("change", sync);
  }, []);

  useEffect(() => {
    if (ref.current?.matches(":popover-open")) ref.current.hidePopover();
  }, [pathname]);

  return (
    <aside ref={ref} id="wiki-navigation" aria-label="위키 탐색" className="lnb" onClick={(event) => {
      if (event.target instanceof Element && event.target.closest("a") && ref.current?.matches(":popover-open")) {
        ref.current.hidePopover();
      }
    }}>
      <div className="nav-heading">
        <strong>위키 탐색</strong>
        <button type="button" className="icon-button" aria-label="탐색 닫기" popoverTarget="wiki-navigation" popoverTargetAction="hide"><WikiIcon name="close" /></button>
      </div>
      {children}
    </aside>
  );
}
