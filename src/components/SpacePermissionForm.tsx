"use client";

import { useActionState, useEffect, useId, useRef, useState } from "react";
import { addSpacePermission } from "@/actions/spaces";
import type { PermissionSearchResult, PermissionSubject } from "@/lib/permission-subjects";
import { WikiIcon } from "./WikiIcon";

const roleLabels = { viewer: "읽기", editor: "편집", admin: "관리" };
type SearchState = PermissionSearchResult & { query: string; error?: string };

export function SpacePermissionForm({ spaceKey }: { spaceKey: string }) {
  const [state, action, pending] = useActionState(addSpacePermission.bind(null, spaceKey), {});
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<PermissionSubject | null>(null);
  const [search, setSearch] = useState<SearchState>({ query: "", items: [], hasMore: false });
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [retry, setRetry] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const id = useId();
  const term = query.trim();
  const ready = search.query === term;
  const items = ready ? search.items : [];
  const showResults = open && !selected && !!term;
  const showList = showResults && items.length > 0;

  useEffect(() => {
    if (selected || !term) return;
    const controller = new AbortController();
    const timeout = setTimeout(async () => {
      try {
        const response = await fetch(`/api/spaces/${encodeURIComponent(spaceKey)}/permission-subjects?q=${encodeURIComponent(term)}`, {
          signal: controller.signal, cache: "no-store",
        });
        if (!response.ok) throw new Error(response.status === 401 ? "로그인 상태를 확인한 뒤 다시 시도하세요."
          : response.status === 403 || response.status === 404 ? "이 스페이스의 관리 권한이 필요합니다."
          : "검색하지 못했습니다. 다시 시도하세요.");
        const result: PermissionSearchResult = await response.json();
        if (!controller.signal.aborted) setSearch({ ...result, query: term });
      } catch (error) {
        if (!controller.signal.aborted) setSearch({ query: term, items: [], hasMore: false,
          error: error instanceof Error ? error.message : "검색하지 못했습니다. 다시 시도하세요." });
      }
    }, 200);
    return () => { clearTimeout(timeout); controller.abort(); };
  }, [query, term, selected, spaceKey, retry]);

  useEffect(() => {
    if (state.success) {
      setSelected(null);
      setQuery("");
      setSearch({ query: "", items: [], hasMore: false });
      setOpen(false);
      setActive(-1);
    }
  }, [state]);

  useEffect(() => {
    if (showList && active >= 0) document.getElementById(`${id}-option-${active}`)?.scrollIntoView({ block: "nearest" });
  }, [active, showList, id]);

  function choose(subject: PermissionSubject) {
    setSelected(subject);
    setQuery(subject.label);
    setOpen(false);
    setActive(-1);
  }

  return (
    <form action={action} aria-label="권한 추가" className="permission-add">
      <input type="hidden" name="subjectType" value={selected?.type ?? ""} />
      <input type="hidden" name="subjectRef" value={selected?.id ?? ""} />
      <div className="settings-form settings-permission-form">
        <div className="permission-picker" onBlur={event => {
          if (!event.currentTarget.contains(event.relatedTarget)) { setOpen(false); setActive(-1); }
        }}>
          <label className="field" htmlFor={`${id}-input`}>
            <span>사용자 또는 그룹</span>
          </label>
          <div className="permission-picker__input">
            <input id={`${id}-input`} ref={inputRef} className="input" role="combobox" type="text"
              autoComplete="off" maxLength={100} placeholder="이름, 아이디, 이메일, 그룹명 검색"
              aria-autocomplete="list" aria-expanded={showList}
              aria-controls={showList ? `${id}-list` : undefined}
              aria-activedescendant={showList && active >= 0 ? `${id}-option-${active}` : undefined}
              aria-describedby={`${id}-help${selected ? ` ${id}-selected` : ""}`}
              value={query} disabled={pending}
              onFocus={() => setOpen(true)}
              onChange={event => {
                setQuery(event.target.value); setSelected(null); setActive(-1); setOpen(true);
                setSearch({ query: "", items: [], hasMore: false });
              }}
              onKeyDown={event => {
                if (event.nativeEvent.isComposing || event.keyCode === 229) return;
                if (event.key === "Escape") { event.preventDefault(); setOpen(false); setActive(-1); }
                if (selected) return;
                if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                  event.preventDefault(); setOpen(true);
                  if (items.length) setActive(current => event.key === "ArrowDown"
                    ? (current + 1) % items.length : (current <= 0 ? items.length : current) - 1);
                } else if (event.key === "Enter") {
                  event.preventDefault();
                  if (showList && active >= 0 && items[active]) choose(items[active]);
                }
              }} />
            {selected && <button type="button" className="permission-picker__clear icon-button" aria-label="선택한 대상 지우기" disabled={pending}
              onClick={() => {
                setSelected(null); setQuery(""); setSearch({ query: "", items: [], hasMore: false });
                inputRef.current?.focus();
              }}><WikiIcon name="close" /></button>}
          </div>
          {showResults && <div className="permission-picker__panel">
            {showList && <ul id={`${id}-list`} role="listbox" aria-label="사용자·그룹 검색 결과" className="permission-picker__list">
              {items.map((subject, index) => <li key={`${subject.type}:${subject.id}`} role="presentation">
                <button type="button" role="option" id={`${id}-option-${index}`} aria-selected={active === index} tabIndex={-1}
                  className="permission-picker__option" onMouseDown={event => event.preventDefault()} onClick={() => choose(subject)}>
                  <span className="permission-picker__type">{subject.type === "group" ? "그룹" : "사용자"}</span>
                  <span className="permission-picker__identity"><strong>{subject.label}</strong><span>{subject.detail}</span></span>
                  {subject.currentRole && <span className="permission-picker__role">현재 {roleLabels[subject.currentRole]}</span>}
                </button>
              </li>)}
            </ul>}
            <div className="permission-picker__status" role="status">
              {!ready ? "검색 중…" : search.error ? <>{search.error} <button type="button" className="linklike" onClick={() => {
                setSearch({ query: "", items: [], hasMore: false }); setRetry(value => value + 1);
              }}>다시 시도</button></> : items.length === 0 ? "검색 결과가 없습니다. 다른 이름이나 아이디로 검색해 보세요."
                : search.hasMore ? "결과가 많습니다. 검색어를 더 구체적으로 입력해 주세요." : `${items.length}개 결과`}
            </div>
          </div>}
        </div>
        <label className="field"><span>역할</span>
          <select name="role" className="select" aria-describedby="role-help" disabled={pending} defaultValue="viewer">
            {Object.entries(roleLabels).map(([role, label]) => <option key={role} value={role}>{label}</option>)}
          </select>
        </label>
        <button className="btn btn-primary" disabled={!selected || pending}>{pending ? "저장 중…" : selected?.currentRole ? "권한 변경" : "권한 추가"}</button>
      </div>
      {selected && <p id={`${id}-selected`} className="settings-help permission-add__selected">
        {selected.type === "group" ? "그룹" : "사용자"} · {selected.label}{selected.detail && ` · ${selected.detail}`}
        {selected.currentRole && ` — 현재 ${roleLabels[selected.currentRole]}. 저장하면 선택한 역할로 변경합니다.`}
      </p>}
      <p id={`${id}-help`} className="settings-help">앞부분이 일치하는 대상을 먼저 찾고, 세 글자 이상은 부분 검색도 합니다. 사용자는 한 번 이상 로그인해야 검색됩니다.</p>
      {state.error && <p role="alert" className="notice notice-warn mt-3">{state.error}</p>}
      {state.success && <p role="status" className="settings-help">{state.success}</p>}
    </form>
  );
}
