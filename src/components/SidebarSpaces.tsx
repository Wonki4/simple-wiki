"use client";

import { useEffect, useOptimistic, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { SpaceVisibility } from "@/lib/permissions";
import { spaceVisibilityInfo } from "@/lib/space-visibility";
import { NavigationLink } from "./NavigationLink";
import { NavLink } from "./NavLink";
import { WikiIcon } from "./WikiIcon";

export interface SidebarSpace {
  key: string;
  name: string;
  visibility: SpaceVisibility;
  favorite: boolean;
}

const visibilities = Object.keys(spaceVisibilityInfo) as SpaceVisibility[];
const storageKey = "wiki.sidebar.collapsedSpaceGroups";
const shortcutLimit = 3;
const noPendingFavorites = new Set<string>();

function normalizeName(name: string) {
  return name.trim().normalize("NFC").toLowerCase();
}

function SpaceRow({ space, shortcut, pending, onToggle }: {
  space: SidebarSpace;
  shortcut?: boolean;
  pending: boolean;
  onToggle: (space: SidebarSpace) => void;
}) {
  const action = `${space.name} 즐겨찾기 ${space.favorite ? "해제" : "추가"}`;
  return (
    <div className="lnb__row lnb__space-row" data-favorite={space.favorite || undefined}>
      <NavLink href={`/s/${space.key}`} prefix>
        <span className="lnb__name" title={`${space.name} (${space.key})`}>{space.name}</span>
        {space.favorite && <span className="sr-only">즐겨찾기</span>}
        {shortcut && space.visibility === "restricted" && (
          <span className="lnb__private-mark" title="비공개"><WikiIcon name="lock" /><span className="sr-only">비공개</span></span>
        )}
        {!shortcut && <span className="lnb__space-key">{space.key}</span>}
      </NavLink>
      <button type="button" className="lnb__star" aria-label={action} title={action}
        aria-pressed={space.favorite} disabled={pending} onClick={() => onToggle(space)}>
        <WikiIcon name="star" />
      </button>
    </div>
  );
}

export function SidebarSpaces({ spaces, isWikiAdmin }: { spaces: SidebarSpace[]; isWikiAdmin: boolean }) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [showAllFavorites, setShowAllFavorites] = useState(false);
  const [editingFavorites, setEditingFavorites] = useState(false);
  const [favoriteError, setFavoriteError] = useState("");
  const [, startTransition] = useTransition();
  const [pendingFavorites, markPending] = useOptimistic(noPendingFavorites,
    (pending, key: string) => new Set(pending).add(key));
  const [collapsed, setCollapsed] = useState<SpaceVisibility[]>([]);
  const [searchCollapsed, setSearchCollapsed] = useState<SpaceVisibility[]>([]);
  const input = useRef<HTMLInputElement>(null);
  const term = normalizeName(query);
  const matches = term ? spaces.filter(space => normalizeName(space.name).includes(term)) : spaces;
  const favorites = spaces.filter(space => space.favorite);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(storageKey)?.split(",");
      if (saved) setCollapsed(visibilities.filter(visibility => saved.includes(visibility)));
    } catch { /* 탐색은 브라우저 저장소 없이도 동작한다. */ }
  }, []);

  function changeQuery(value: string) {
    setQuery(value);
    if (normalizeName(value) !== term) setSearchCollapsed([]);
  }

  function toggleGroup(visibility: SpaceVisibility) {
    const previous = term ? searchCollapsed : collapsed;
    const next = previous.includes(visibility)
      ? previous.filter(value => value !== visibility)
      : [...previous, visibility];
    if (term) {
      setSearchCollapsed(next);
    } else {
      setCollapsed(next);
      try { localStorage.setItem(storageKey, next.join(",")); } catch { /* 저장소가 차단된 경우 */ }
    }
  }

  function clearSearch() {
    changeQuery("");
    input.current?.focus();
  }

  function toggleFavorite(space: SidebarSpace) {
    setFavoriteError("");
    startTransition(async () => {
      markPending(space.key);
      try {
        const response = await fetch(`/api/spaces/${encodeURIComponent(space.key)}/favorite`, {
          method: space.favorite ? "DELETE" : "PUT",
        });
        if (!response.ok) throw new Error("favorite");
      } catch {
        setFavoriteError("즐겨찾기를 변경하지 못했습니다. 다시 시도해 주세요.");
      }
      startTransition(() => router.refresh());
    });
  }

  return (
    <div className="lnb__top" data-editing-favorites={editingFavorites || undefined}>
      <div className="lnb__spaces-heading">
        <label className="lnb__label" htmlFor="sidebar-space-search">스페이스</label>
        {spaces.length > 0 && (
          <button type="button" className="lnb__favorite-edit" onClick={() => setEditingFavorites(!editingFavorites)}>
            {editingFavorites ? "완료" : "즐겨찾기 편집"}
          </button>
        )}
      </div>
      <div className="lnb__space-search">
        <input ref={input} id="sidebar-space-search" className="lnb__filter" type="search"
          aria-label="스페이스 이름 검색" placeholder="스페이스 이름 검색" autoComplete="off"
          value={query} onChange={event => changeQuery(event.target.value)}
          onKeyDown={event => {
            if (event.key === "Escape" && query && !event.nativeEvent.isComposing) {
              event.preventDefault();
              clearSearch();
            }
          }} />
        {query && <button type="button" aria-label="스페이스 검색 지우기" onClick={clearSearch}><WikiIcon name="close" /></button>}
      </div>
      {favoriteError && <p className="lnb__favorite-error" role="alert">{favoriteError}</p>}
      <div className="lnb__space-results">
        {!term && favorites.length > 0 && (
          <div className="lnb__favorites" role="group" aria-labelledby="nav-favorites">
            <div className="lnb__favorites-head">
              <span id="nav-favorites">내 즐겨찾기</span>
              {favorites.length > shortcutLimit && (
                <button type="button" aria-expanded={showAllFavorites} aria-controls="nav-favorites-list"
                  onClick={() => setShowAllFavorites(!showAllFavorites)}>
                  {showAllFavorites ? "접기" : `더 보기 (${favorites.length})`}
                </button>
              )}
            </div>
            <div id="nav-favorites-list" className="lnb__list">
              {(showAllFavorites ? favorites : favorites.slice(0, shortcutLimit)).map(space => (
                <SpaceRow key={space.key} space={space} shortcut pending={pendingFavorites.has(space.key)} onToggle={toggleFavorite} />
              ))}
            </div>
          </div>
        )}
        {visibilities.map(visibility => {
          const group = matches.filter(space => space.visibility === visibility);
          if (!group.length) return null;
          if (term) group.sort((a, b) => Number(b.favorite) - Number(a.favorite));
          const { label, icon } = spaceVisibilityInfo[visibility];
          const expanded = !(term ? searchCollapsed : collapsed).includes(visibility);
          const id = `nav-${visibility}`;
          return (
            <div className="lnb__space-group" key={visibility} role="group" aria-labelledby={id}>
              <button type="button" className="lnb__group-title" aria-expanded={expanded}
                aria-controls={`${id}-list`} onClick={() => toggleGroup(visibility)}>
                <WikiIcon name={icon} /><span id={id}>{label}</span>
                <span className="lnb__group-count" aria-hidden="true">{group.length}</span>
                <span className="lnb__group-chevron" aria-hidden="true" />
              </button>
              <div id={`${id}-list`} className="lnb__list" hidden={!expanded} key={term}>
                {expanded && group.map(space => (
                  <SpaceRow key={space.key} space={space} pending={pendingFavorites.has(space.key)} onToggle={toggleFavorite} />
                ))}
              </div>
            </div>
          );
        })}
        {term && !matches.length && <p className="lnb__empty" role="status">일치하는 스페이스가 없습니다.</p>}
      </div>
      {isWikiAdmin && <NavigationLink href="/spaces/new" className="lnb__add">+ 새 스페이스</NavigationLink>}
    </div>
  );
}
