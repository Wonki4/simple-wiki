import Link from "next/link";
import { requireSpaceRole } from "@/lib/access";
import { prisma } from "@/lib/db";
import { hasRole } from "@/lib/permissions";

export default async function SpaceHome({ params }: { params: Promise<{ spaceKey: string }> }) {
  const { spaceKey } = await params;
  const { space, role } = await requireSpaceRole(spaceKey, "viewer");
  const pages = await prisma.page.findMany({
    where: { spaceId: space.id },
    orderBy: { updatedAt: "desc" },
    select: { id: true, slug: true, title: true, updatedAt: true },
  });
  return (
    <main className="py-10">
      <div className="flex items-end justify-between gap-4">
        <div>
          <p className="eyebrow">{space.key}</p>
          <h1 className="page-title mt-1">{space.name}</h1>
          {space.description && <p className="muted mt-1.5 text-sm">{space.description}</p>}
        </div>
        <div className="flex shrink-0 gap-2">
          {hasRole(role, "editor") && (
            <Link href={`/s/${spaceKey}/new`} className="btn btn-primary">
              새 페이지
            </Link>
          )}
          {hasRole(role, "admin") && (
            <Link href={`/s/${spaceKey}/settings`} className="btn btn-ghost">
              설정
            </Link>
          )}
        </div>
      </div>

      <ul className="mt-7">
        {pages.map((p) => (
          <li key={p.id} className="row">
            <Link href={`/s/${spaceKey}/${encodeURIComponent(p.slug)}`} className="row__title title-link">
              {p.title}
            </Link>
            <span className="meta">{p.updatedAt.toISOString().slice(0, 10)}</span>
          </li>
        ))}
        {pages.length === 0 && (
          <li className="muted mt-4 text-sm">아직 페이지가 없습니다.</li>
        )}
      </ul>
    </main>
  );
}
