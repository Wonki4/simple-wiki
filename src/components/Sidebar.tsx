import Link from "next/link";
import { NavLink } from "@/components/NavLink";

interface SpaceItem {
  key: string;
  name: string;
}
interface PageItem {
  slug: string;
  title: string;
}

interface Props {
  spaces: SpaceItem[];
  currentKey: string;
  currentName: string;
  pages: PageItem[];
  canEdit: boolean;
  canManage: boolean;
  isWikiAdmin: boolean;
}

export function Sidebar({ spaces, currentKey, currentName, pages, canEdit, canManage, isWikiAdmin }: Props) {
  return (
    <aside className="lnb">
      <nav className="lnb__section">
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
      </nav>

      <nav className="lnb__section">
        <p className="lnb__label">{currentName} · 문서</p>
        <div className="lnb__list">
          {pages.map((p) => (
            <NavLink key={p.slug} href={`/s/${currentKey}/${encodeURIComponent(p.slug)}`}>
              <span className="lnb__name">{p.title}</span>
            </NavLink>
          ))}
        </div>
        {pages.length === 0 && <p className="lnb__empty">문서 없음</p>}
        {canEdit && (
          <Link href={`/s/${currentKey}/new`} className="lnb__add">
            + 새 문서
          </Link>
        )}
      </nav>

      {canManage && (
        <nav className="lnb__section">
          <Link href={`/s/${currentKey}/settings`} className="lnb__add">
            스페이스 설정
          </Link>
        </nav>
      )}
    </aside>
  );
}
