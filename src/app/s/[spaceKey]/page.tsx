import Link from "next/link";
import { requireSpaceRole } from "@/lib/access";
import { prisma } from "@/lib/db";
import { hasRole } from "@/lib/permissions";
import { WikiIcon } from "@/components/WikiIcon";

export default async function SpaceHome({ params }: { params: Promise<{ spaceKey: string }> }) {
  const { spaceKey } = await params;
  const { space, role } = await requireSpaceRole(spaceKey, "viewer");
  const pages = await prisma.page.findMany({
    where: { spaceId: space.id },
    orderBy: [{ updatedAt: "desc" }, { title: "asc" }],
    select: { id: true, slug: true, title: true, updatedAt: true },
  });
  return (
    <main className="collection">
      <div className="document-path"><WikiIcon name="book" />스페이스</div>
      <header className="collection-heading">
        <h1 className="document-title">{space.name}</h1>
        {space.description && <p>{space.description}</p>}
      </header>
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
