import { SidebarFrame } from "./SidebarFrame";
import { SidebarSpaces, type SidebarSpace } from "./SidebarSpaces";
import { SidebarDocs } from "@/components/SidebarDocs";
import { SidebarResizer } from "@/components/SidebarResizer";
import type { TreePageInput } from "@/lib/page-tree";

interface Props {
  spaces: SidebarSpace[];
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
      <SidebarSpaces spaces={spaces} isWikiAdmin={isWikiAdmin} />

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
