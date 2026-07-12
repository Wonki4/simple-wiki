"use client";

import { useState } from "react";
import Link from "next/link";
import { NavLink } from "@/components/NavLink";

interface PageItem {
  slug: string;
  title: string;
}

interface Props {
  currentKey: string;
  currentName: string;
  pages: PageItem[];
  canEdit: boolean;
  canManage: boolean;
}

export function SidebarDocs({ currentKey, currentName, pages, canEdit, canManage }: Props) {
  const [q, setQ] = useState("");
  const query = q.trim().toLowerCase();
  const filtered = query ? pages.filter((p) => p.title.toLowerCase().includes(query)) : pages;

  return (
    <div className="lnb__docs">
      <div className="lnb__docs-head">
        <p className="lnb__label">{currentName} · 문서</p>
        {/* 문서가 많을 때만 필터 노출 */}
        {pages.length > 8 && (
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="빠른 찾기"
            aria-label="빠른 찾기"
            className="lnb__filter"
          />
        )}
      </div>

      <div className="lnb__docs-list">
        <div className="lnb__list">
          {filtered.map((p) => (
            <NavLink key={p.slug} href={`/s/${currentKey}/${encodeURIComponent(p.slug)}`}>
              <span className="lnb__name">{p.title}</span>
            </NavLink>
          ))}
        </div>
        {pages.length === 0 && <p className="lnb__empty">문서 없음</p>}
        {pages.length > 0 && filtered.length === 0 && <p className="lnb__empty">일치하는 문서 없음</p>}
      </div>

      <div className="lnb__bottom">
        {canEdit && (
          <Link href={`/s/${currentKey}/new`} className="lnb__add">
            + 새 문서
          </Link>
        )}
        {canManage && (
          <Link href={`/s/${currentKey}/settings`} className="lnb__add">
            스페이스 설정
          </Link>
        )}
      </div>
    </div>
  );
}
