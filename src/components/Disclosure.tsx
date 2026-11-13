"use client";

import { useEffect, useRef, type ReactNode } from "react";

export function Disclosure({ label, trigger, children, className = "" }: {
  label: string;
  trigger: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  const ref = useRef<HTMLDetailsElement>(null);

  useEffect(() => {
    function dismiss(event: PointerEvent | FocusEvent) {
      const menu = ref.current;
      if (menu?.open && event.target instanceof Node && !menu.contains(event.target)) menu.open = false;
    }
    function escape(event: KeyboardEvent) {
      if (event.key === "Escape" && ref.current?.open) {
        ref.current.open = false;
        ref.current.querySelector("summary")?.focus();
      }
    }
    document.addEventListener("pointerdown", dismiss);
    document.addEventListener("focusin", dismiss);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", dismiss);
      document.removeEventListener("focusin", dismiss);
      document.removeEventListener("keydown", escape);
    };
  }, []);

  return (
    <details ref={ref} className={`disclosure ${className}`}>
      <summary role="button" className="icon-button" aria-label={label} title={label}>{trigger}</summary>
      <div className="disclosure__panel" onClick={(event) => {
        if (event.target instanceof Element && event.target.closest("a") && ref.current) ref.current.open = false;
      }}>
        {children}
      </div>
    </details>
  );
}
