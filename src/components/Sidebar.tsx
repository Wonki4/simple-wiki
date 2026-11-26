import { WikiIcon } from "./WikiIcon";
import { SidebarFrame } from "./SidebarFrame";
import { NavigationLink as Link } from "./NavigationLink";
import { NavLink } from "@/components/NavLink";
import { SidebarDocs } from "@/components/SidebarDocs";
import { SidebarResizer } from "@/components/SidebarResizer";
import type { TreePageInput } from "@/lib/page-tree";
import type { SpaceVisibility } from "@/lib/permissions";
import { spaceVisibilityInfo } from "@/lib/space-visibility";

interface SpaceItem {
  key: string;
  name: string;
  visibility: SpaceVisibility;
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
    <SidebarFrame>
      {/* 상단 고정: 스페이스 */}
      <div className="lnb__top">
        <p className="lnb__label">스페이스</p>
        {Object.entries(spaceVisibilityInfo).map(([visibility, { label, icon }]) => {
          const groupSpaces = spaces.filter(space => space.visibility === visibility);
          if (!groupSpaces.length) return null;
          return (
            <div className="lnb__space-group" key={visibility} role="group" aria-labelledby={`nav-${visibility}`}>
              <p className="lnb__group-title" id={`nav-${visibility}`}><WikiIcon name={icon} />{label}</p>
              <div className="lnb__list">
                {groupSpaces.map(space => (
                  <NavLink key={space.key} href={`/s/${space.key}`} prefix>
                    <span className="lnb__name">{space.name}</span>
                    <span className="lnb__space-key">{space.key}</span>
                  </NavLink>
                ))}
              </div>
            </div>
          );
        })}
        {isWikiAdmin && (
          <Link href="/spaces/new" className="lnb__add">
            + 새 스페이스
          </Link>
        )}
      </div>

      {/* 문서 목록(스크롤) + 필터 + 액션(하단 고정) */}
      {currentKey && (
        <SidebarDocs
          currentKey={currentKey}
          currentName={currentName}
          pages={pages}
          canEdit={canEdit}
          canManage={canManage}
        />
      )}

      <SidebarResizer />
    </SidebarFrame>
  );
}
