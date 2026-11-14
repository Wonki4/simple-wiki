"use client";

import { useContext, useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { completedLink, matchingPages, type LinkPage } from "@/lib/wiki-link-completion";
import { splitWikiTarget } from "@/lib/wiki-links";
import { wikiSections } from "@/lib/wiki-sections";
import type { LinkTarget } from "@/lib/editor-link-target";
import { SpacePagesContext } from "./SpacePagesContext";

interface Menu {
  start: number;
  query: string;
  input: HTMLElement;
  pages: LinkPage[];
  index: number;
  kind: "local" | "space" | "section";
  left: number;
  top?: number;
  bottom?: number;
}

export function WikiLinkCompletion({ readTarget, readMarkdown, spaceKey, children }: {
  readTarget: () => LinkTarget | null;
  readMarkdown: () => string;
  spaceKey: string;
  children: ReactNode;
}) {
  const { pages, spaces } = useContext(SpacePagesContext);
  const [menu, setMenu] = useState<Menu | null>(null);
  const composing = useRef(false);
  const pending = useRef<AbortController | null>(null);
  const frame = useRef(0);
  const listId = useId();
  const list = useRef<HTMLUListElement>(null);

  function close() {
    pending.current?.abort();
    cancelAnimationFrame(frame.current);
    setMenu(null);
  }

  function refresh() {
    cancelAnimationFrame(frame.current);
    pending.current?.abort();
    frame.current = requestAnimationFrame(async () => {
      const target = !composing.current && readTarget();
      if (!target) return setMenu(null);
      const rect = target.rect();
      const { space, name, section } = splitWikiTarget(target.query);
      const kind = section !== undefined ? "section" : space ? "space" : "local";
      let results: LinkPage[];
      if (kind === "local") {
        results = matchingPages(pages, target.query);
        if (name) {
          const scopeOptions = spaces.filter(s => s.key !== spaceKey && (s.key.startsWith(name.toLowerCase()) || s.name.includes(name)))
            .map(s => ({ title: s.name, slug: s.key + ":" }));
          results = [...results, ...scopeOptions];
        }
      } else if (kind === "section" && !name && space) {
        results = [];
      } else if (kind === "section" && !name) {
        const sections = wikiSections(readMarkdown()).map(s => ({ title: s.title, slug: s.id.slice("section-".length) }));
        results = matchingPages(sections, section ?? "");
      } else {
        setMenu(null);
        const request = new AbortController();
        pending.current = request;
        const params = new URLSearchParams(section !== undefined ? { document: name } : { q: name });
        try {
          const res = await fetch(`/api/spaces/${encodeURIComponent(space ?? spaceKey)}/wiki-links?${params}`, { signal: request.signal });
          results = res.ok ? await res.json() : [];
          if (section !== undefined) results = matchingPages(results, section);
        } catch { results = []; }
        if (request.signal.aborted || readTarget()?.query !== target.query) return;
      }
      const width = Math.min(304, window.innerWidth - 16);
      const above = window.innerHeight - rect.bottom < Math.min(results.length * 40 + 16, 240) && rect.top > window.innerHeight / 2;
      setMenu(previous => ({
        start: target.start, query: target.query, input: target.input, pages: results, kind,
        index: previous?.query === target.query && previous.start === target.start ? Math.min(previous.index, Math.max(0, results.length - 1)) : 0,
        left: Math.min(Math.max(8, rect.left), window.innerWidth - width - 8),
        ...(above ? { bottom: window.innerHeight - rect.top + 4 } : { top: rect.bottom + 4 }),
      }));
    });
  }

  useEffect(() => () => { cancelAnimationFrame(frame.current); pending.current?.abort(); }, []);
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
      const { space, section } = splitWikiTarget(target.query);
      if (menu.kind === "local" && page.slug.endsWith(":")) {
        target.replace("[[" + page.slug);
        refresh();
        return;
      }
      if (section !== undefined) {
        const document = target.query.slice(0, target.query.indexOf("#"));
        target.replace(`[[${document}#${page.slug}${target.label ? `|${target.label}` : ""}]]`);
      } else {
        target.replace(completedLink(page, target.label, space));
      }
    }
    close();
  }

  function handleKey(event: KeyboardEvent) {
    if (!menu && event.key === "Escape") pending.current?.abort();
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
        <ul ref={list} id={listId} role="listbox" aria-label={menu.kind === "local" ? "같은 스페이스 문서" : menu.kind === "section" ? "문서 소제목" : "스페이스 문서"} className="wiki-link-options"
          style={{ left: menu.left, top: menu.top, bottom: menu.bottom }} onMouseDown={event => event.preventDefault()}>
          {menu.pages.map((page, index) => (
            <li key={page.slug} id={`${listId}-${index}`} role="option" aria-selected={index === menu.index}
              onClick={() => choose(page)}>
              <span>{page.title}</span>
              {page.title !== page.slug && <small>{page.slug}</small>}
            </li>
          ))}
          {!menu.pages.length && <li role="presentation" className="wiki-link-empty">{menu.kind === "section" ? "일치하는 소제목이 없습니다." : "일치하는 문서가 없습니다."}</li>}
        </ul>
      )}
    </div>
  );
}
