import Link from "next/link";
import { requireSpaceRole } from "@/lib/access";
import { prisma } from "@/lib/db";

export default async function SpaceHome({ params }: { params: Promise<{ spaceKey: string }> }) {
  const { spaceKey } = await params;
  const { space } = await requireSpaceRole(spaceKey, "viewer");
  const pages = await prisma.page.findMany({
    where: { spaceId: space.id },
    orderBy: { updatedAt: "desc" },
    select: { id: true, slug: true, title: true, updatedAt: true },
  });
  return (
    <main className="py-10">
      <p className="eyebrow">{space.key}</p>
      <h1 className="page-title mt-1">{space.name}</h1>
      {space.description && <p className="muted mt-1.5 text-sm">{space.description}</p>}

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
          <li className="muted mt-4 text-sm">
            아직 문서가 없습니다. 왼쪽 메뉴의 &ldquo;+ 새 문서&rdquo;로 첫 문서를 만들어 보세요.
          </li>
        )}
      </ul>
    </main>
  );
}
