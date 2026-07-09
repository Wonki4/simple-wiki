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
    <main className="py-8">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">{space.name}</h1>
        <div className="flex gap-2 text-sm">
          {hasRole(role, "editor") && (
            <Link href={`/s/${spaceKey}/new`} className="rounded bg-blue-600 px-3 py-1.5 text-white">
              새 페이지
            </Link>
          )}
          {hasRole(role, "admin") && (
            <Link href={`/s/${spaceKey}/settings`} className="rounded border border-gray-300 px-3 py-1.5">
              설정
            </Link>
          )}
        </div>
      </div>
      {space.description && <p className="mt-1 text-gray-500">{space.description}</p>}
      <ul className="mt-6 space-y-1">
        {pages.map((p) => (
          <li key={p.id} className="flex items-baseline justify-between border-b border-gray-100 py-2">
            <Link href={`/s/${spaceKey}/${encodeURIComponent(p.slug)}`} className="text-blue-600 underline">
              {p.title}
            </Link>
            <span className="text-xs text-gray-400">{p.updatedAt.toISOString().slice(0, 10)}</span>
          </li>
        ))}
        {pages.length === 0 && <li className="text-gray-500">아직 페이지가 없습니다.</li>}
      </ul>
    </main>
  );
}
