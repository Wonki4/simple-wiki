"use client";

import { useContext, useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { completedLink, matchingPages, type LinkPage } from "@/lib/wiki-link-completion";
import type { LinkTarget } from "@/lib/editor-link-target";
import { SpacePagesContext } from "./SpacePagesContext";

interface Menu {
  start: number;
  query: string;
  input: HTMLElement;
  pages: LinkPage[];
  index: number;
  left: number;
  top?: number;
  bottom?: number;
}

export function WikiLinkCompletion({ readTarget, children }: { readTarget: () => LinkTarget | null; children: ReactNode }) {
  const pages = useContext(SpacePagesContext);
  const [menu, setMenu] = useState<Menu | null>(null);
  const composing = useRef(false);
  const frame = useRef(0);
  const listId = useId();
  const list = useRef<HTMLUListElement>(null);

  function close() {
    cancelAnimationFrame(frame.current);
    setMenu(null);
  }

  function refresh() {
    cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(() => {
      const target = !composing.current && readTarget();
      if (!target) return setMenu(null);
      const rect = target.rect();
      const results = matchingPages(pages, target.query);
      const width = Math.min(304, window.innerWidth - 16);
      const above = window.innerHeight - rect.bottom < Math.min(results.length * 40 + 16, 240) && rect.top > window.innerHeight / 2;
      setMenu(previous => ({
        start: target.start, query: target.query, input: target.input, pages: results,
        index: previous?.query === target.query && previous.start === target.start ? Math.min(previous.index, Math.max(0, results.length - 1)) : 0,
        left: Math.min(Math.max(8, rect.left), window.innerWidth - width - 8),
        ...(above ? { bottom: window.innerHeight - rect.top + 4 } : { top: rect.bottom + 4 }),
      }));
    });
  }

  useEffect(() => () => cancelAnimationFrame(frame.current), []);
  const open = !!menu;
  useEffect(() => {
    if (!open) return;
    const onScroll = (event: Event) => {
      if (event.target instanceof Node && list.current?.contains(event.target)) return;
      close();
    };
    document.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", close);
    return () => {
      document.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", close);
    };
  }, [open]);

  useEffect(() => {
    if (!menu) return;
    const input = menu.input;
    input.setAttribute("aria-controls", listId);
    input.setAttribute("aria-autocomplete", "list");
    if (menu.pages.length) {
      input.setAttribute("aria-activedescendant", `${listId}-${menu.index}`);
      const box = list.current;
      const option = box?.children[menu.index];
      if (box && option instanceof HTMLElement) {
        if (option.offsetTop < box.scrollTop) box.scrollTop = option.offsetTop;
        else if (option.offsetTop + option.offsetHeight > box.scrollTop + box.clientHeight) {
          box.scrollTop = option.offsetTop + option.offsetHeight - box.clientHeight;
        }
      }
    }
    return () => {
      input.removeAttribute("aria-controls");
      input.removeAttribute("aria-autocomplete");
      input.removeAttribute("aria-activedescendant");
    };
  }, [menu, listId]);

  function choose(page: LinkPage) {
    const target = readTarget();
    if (target && menu && target.start === menu.start && target.query === menu.query && target.input === menu.input) {
      target.replace(completedLink(page, target.label));
    }
    close();
  }

  function handleKey(event: KeyboardEvent) {
    if (!menu || composing.current || event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return;
    if (event.key === "Escape") {
      close();
    } else if (menu.pages.length && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
      const step = event.key === "ArrowDown" ? 1 : -1;
      setMenu({ ...menu, index: (menu.index + step + menu.pages.length) % menu.pages.length });
    } else if (menu.pages.length && event.key === "Enter") {
      choose(menu.pages[menu.index]);
    } else {
      if (["ArrowLeft", "ArrowRight", "Home", "End", "Tab"].includes(event.key)) close();
      return;
    }
    event.preventDefault();
    event.stopPropagation();
  }

  return (
    <div onInput={refresh} onClick={event => { if (!list.current?.contains(event.target as Node)) close(); }}
      onBlur={close} onKeyDownCapture={handleKey}
      onCompositionStart={() => { composing.current = true; close(); }}
      onCompositionEnd={() => { composing.current = false; refresh(); }}>
      {children}
      {menu && (
        <ul ref={list} id={listId} role="listbox" aria-label="같은 스페이스 문서" className="wiki-link-options"
          style={{ left: menu.left, top: menu.top, bottom: menu.bottom }} onMouseDown={event => event.preventDefault()}>
          {menu.pages.map((page, index) => (
            <li key={page.slug} id={`${listId}-${index}`} role="option" aria-selected={index === menu.index}
              onClick={() => choose(page)}>
              <span>{page.title}</span>
              {page.title !== page.slug && <small>{page.slug}</small>}
            </li>
          ))}
          {!menu.pages.length && <li role="presentation" className="wiki-link-empty">일치하는 문서가 없습니다.</li>}
        </ul>
      )}
    </div>
  );
}
