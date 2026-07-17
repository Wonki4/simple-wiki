import Link from "next/link";
import { NavLink } from "@/components/NavLink";
import { SidebarDocs } from "@/components/SidebarDocs";
import type { TreePageInput } from "@/lib/page-tree";

interface SpaceItem {
  key: string;
  name: string;
}

interface Props {
  spaces: SpaceItem[];
  currentKey: string;
  currentName: string;
  pages: TreePageInput[];
  canEdit: boolean;
  canManage: boolean;
  isWikiAdmin: boolean;
}

export function Sidebar({ spaces, currentKey, currentName, pages, canEdit, canManage, isWikiAdmin }: Props) {
  return (
    <aside className="lnb">
      {/* 상단 고정: 스페이스 */}
      <div className="lnb__top">
        <p className="lnb__label">스페이스</p>
        <div className="lnb__list">
          {spaces.map((s) => (
            <NavLink key={s.key} href={`/s/${s.key}`} prefix>
              <span className="lnb__key">{s.key}</span>
              <span className="lnb__name">{s.name}</span>
            </NavLink>
          ))}
        </div>
        {isWikiAdmin && (
          <Link href="/spaces/new" className="lnb__add">
            + 새 스페이스
          </Link>
        )}
      </div>

      {/* 문서 목록(스크롤) + 필터 + 액션(하단 고정) */}
      <SidebarDocs
        currentKey={currentKey}
        currentName={currentName}
        pages={pages}
        canEdit={canEdit}
        canManage={canManage}
      />
    </aside>
  );
}
