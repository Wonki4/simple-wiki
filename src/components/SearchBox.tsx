"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";

export function SearchBox() {
  const pathname = usePathname();
  const params = useSearchParams();
  const query = pathname === "/search" ? params.get("q") ?? "" : "";
  const inSpace = pathname.match(/^\/s\/([^/]+)/)?.[1];
  const scope = inSpace ?? (pathname === "/search" ? params.get("space") : null);
  const origin = inSpace ?? (pathname === "/search" ? params.get("from") : null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [keyLabel, setKeyLabel] = useState("⌘K");

  useEffect(() => {
    const isMac = /Mac|iPhone|iPad|iPod/.test(navigator.userAgent);
    setKeyLabel(isMac ? "⌘K" : "Ctrl K");

    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        inputRef.current?.focus();
      } else if (e.key === "Escape" && document.activeElement === inputRef.current) {
        inputRef.current?.blur();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <form action="/search" method="GET" className="search">
      {origin && <input type="hidden" name="from" value={origin} />}
      {scope && <input type="hidden" name="space" value={scope} />}
      <div className="search__box">
        <svg className="search__icon" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="2" />
          <line x1="16.5" y1="16.5" x2="21" y2="21" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
        <input
          key={pathname + ":" + query}
          defaultValue={query}
          ref={inputRef}
          type="search"
          name="q"
          placeholder={scope ? "이 스페이스에서 검색" : "문서 검색"}
          aria-label="문서 검색"
          className="search__field"
        />
        <kbd className="search__kbd" aria-hidden="true">
          {keyLabel}
        </kbd>
      </div>
    </form>
  );
}
