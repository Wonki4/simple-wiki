import { Sidebar } from "./Sidebar";
import { SpacePagesProvider } from "./SpacePagesContext";
import { prisma } from "@/lib/db";
import type { SpaceWithPermissions } from "@/lib/access";
import { hasRole, resolveSpaceRole, type SessionInfo } from "@/lib/permissions";

interface Props {
  children: React.ReactNode;
  spaces: SpaceWithPermissions[];
  current?: SpaceWithPermissions;
  session: SessionInfo;
}

export async function WikiShell({ children, spaces, current, session }: Props) {
  const pages = current ? await prisma.page.findMany({
    where: { spaceId: current.id },
    orderBy: { title: "asc" },
    select: { id: true, slug: true, title: true, parentId: true },
  }) : [];
  const role = current ? resolveSpaceRole(session, current.visibility, current.permissions) : null;

  return (
    <div className="shell">
      <Sidebar
        spaces={spaces.map(({ key, name }) => ({ key, name }))}
        currentKey={current?.key ?? ""}
        currentName={current?.name ?? ""}
        pages={pages}
        canEdit={hasRole(role, "editor")}
        canManage={hasRole(role, "admin")}
        isWikiAdmin={session.isWikiAdmin}
      />
      <div className="shell__content"><div className="shell__inner">
        <SpacePagesProvider pages={pages}>{children}</SpacePagesProvider>
      </div></div>
    </div>
  );
}
