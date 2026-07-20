import { requireSpaceRole, listReadableSpaces } from "@/lib/access";
import { prisma } from "@/lib/db";
import { hasRole } from "@/lib/permissions";
import { Sidebar } from "@/components/Sidebar";

export default async function SpaceLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ spaceKey: string }>;
}) {
  const { spaceKey } = await params;
  // 접근 권한 확인(restricted 무권한이면 notFound) + 사이드바 데이터
  const { session, space, role } = await requireSpaceRole(spaceKey, "viewer");
  const [spaces, pages] = await Promise.all([
    listReadableSpaces(session),
    prisma.page.findMany({
      where: { spaceId: space.id },
      orderBy: { title: "asc" },
      select: { id: true, slug: true, title: true, parentId: true },
    }),
  ]);

  return (
    <div className="shell">
      <Sidebar
        spaces={spaces.map((s) => ({ key: s.key, name: s.name }))}
        currentKey={space.key}
        currentName={space.name}
        pages={pages}
        canEdit={hasRole(role, "editor")}
        canManage={hasRole(role, "admin")}
        isWikiAdmin={session.isWikiAdmin}
      />
      <div className="shell__content">
        <div className="shell__inner">{children}</div>
      </div>
    </div>
  );
}
