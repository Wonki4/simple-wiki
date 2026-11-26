import { NavigationLink as Link } from "@/components/NavigationLink";
import { requireSpaceRole } from "@/lib/access";
import { prisma } from "@/lib/db";
import { hasRole } from "@/lib/permissions";
import { WikiIcon } from "@/components/WikiIcon";
import { SpaceCollectionNav } from "@/components/SpaceCollectionNav";
import { spaceVisibilityInfo } from "@/lib/space-visibility";

export default async function SpaceHome({ params }: { params: Promise<{ spaceKey: string }> }) {
  const { spaceKey } = await params;
  const { space, role } = await requireSpaceRole(spaceKey, "viewer");
  const visibility = spaceVisibilityInfo[space.visibility];
  const pages = await prisma.page.findMany({
    where: { spaceId: space.id, deletedAt: null },
    orderBy: [{ updatedAt: "desc" }, { title: "asc" }],
    select: { id: true, slug: true, title: true, updatedAt: true },
  });
  return (
    <main className="collection">
      <div className="document-path" title={visibility.description}>
        <WikiIcon name={visibility.icon} /><span>{visibility.label}</span>
      </div>
      <header className="collection-heading">
        <h1 className="document-title">{space.name}</h1>
        {space.description && <p>{space.description}</p>}
      </header>
      <SpaceCollectionNav spaceKey={space.key} active="documents" canEdit={hasRole(role, "editor")} />
      <h2 className="collection-label">최근 수정한 문서</h2>
      {pages.length > 0 ? (
        <ul className="recent-list">
          {pages.map((p) => (
            <li key={p.id}>
              <Link href={`/s/${spaceKey}/${encodeURIComponent(p.slug)}`}>
                <WikiIcon name="file" /><span>{p.title}</span>
                <time dateTime={p.updatedAt.toISOString()}>{p.updatedAt.toISOString().slice(0, 10)}</time>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <div className="empty-collection">
          <p>아직 문서가 없습니다.</p>
          {hasRole(role, "editor") && <Link href={`/s/${spaceKey}/new`} className="btn btn-primary">첫 문서 작성</Link>}
        </div>
      )}
    </main>
  );
}
