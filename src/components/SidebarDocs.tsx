"use client";

import { useState } from "react";
import Link from "next/link";
import { NavLink } from "@/components/NavLink";
import { buildTree, type TreeNode, type TreePageInput } from "@/lib/page-tree";

interface Props {
  currentKey: string;
  currentName: string;
  pages: TreePageInput[];
  canEdit: boolean;
  canManage: boolean;
}

function TreeItem({
  node,
  currentKey,
  depth,
  collapsed,
  onToggle,
}: {
  node: TreeNode;
  currentKey: string;
  depth: number;
  collapsed: Set<string>;
  onToggle: (id: string) => void;
}) {
  const hasChildren = node.children.length > 0;
  const isCollapsed = collapsed.has(node.id);
  return (
    <div>
      <div className="flex items-center" style={{ paddingLeft: depth * 12 }}>
        {hasChildren ? (
          <button
            type="button"
            aria-label={isCollapsed ? "펼치기" : "접기"}
            onClick={() => onToggle(node.id)}
            className="lnb__twisty"
          >
            {isCollapsed ? "▸" : "▾"}
          </button>
        ) : (
          <span className="lnb__twisty" aria-hidden="true" />
        )}
        <NavLink href={`/s/${currentKey}/${encodeURIComponent(node.slug)}`}>
          <span className="lnb__name">{node.title}</span>
        </NavLink>
      </div>
      {hasChildren && !isCollapsed && (
        <div>
          {node.children.map((c) => (
            <TreeItem key={c.id} node={c} currentKey={currentKey} depth={depth + 1} collapsed={collapsed} onToggle={onToggle} />
          ))}
        </div>
      )}
    </div>
  );
}

export function SidebarDocs({ currentKey, currentName, pages, canEdit, canManage }: Props) {
  const [q, setQ] = useState("");
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const query = q.trim().toLowerCase();
  const filtered = query ? pages.filter((p) => p.title.toLowerCase().includes(query)) : [];
  const tree = buildTree(pages);

  const toggle = (id: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

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
          {/* 필터 입력 중에는 플랫 매칭 목록, 비우면 트리 */}
          {query
            ? filtered.map((p) => (
                <NavLink key={p.id} href={`/s/${currentKey}/${encodeURIComponent(p.slug)}`}>
                  <span className="lnb__name">{p.title}</span>
                </NavLink>
              ))
            : tree.map((n) => (
                <TreeItem key={n.id} node={n} currentKey={currentKey} depth={0} collapsed={collapsed} onToggle={toggle} />
              ))}
        </div>
        {pages.length === 0 && <p className="lnb__empty">문서 없음</p>}
        {query !== "" && pages.length > 0 && filtered.length === 0 && (
          <p className="lnb__empty">일치하는 문서 없음</p>
        )}
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
