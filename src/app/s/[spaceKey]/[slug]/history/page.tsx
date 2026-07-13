import Link from "next/link";
import { notFound } from "next/navigation";
import { requireSpaceRole } from "@/lib/access";
import { prisma } from "@/lib/db";
import { EditSourceBadge } from "@/components/EditSourceBadge";

export default async function HistoryPage({ params }: { params: Promise<{ spaceKey: string; slug: string }> }) {
  const { spaceKey, slug: rawSlug } = await params;
  const slug = decodeURIComponent(rawSlug);
  const { space } = await requireSpaceRole(spaceKey, "viewer");
  const page = await prisma.page.findUnique({
    where: { spaceId_slug: { spaceId: space.id, slug } },
    include: { revisions: { orderBy: { version: "desc" } } },
  });
  if (!page) notFound();

  const authorIds = [...new Set(page.revisions.map((r) => r.authorId))];
  const authors = await prisma.user.findMany({
    where: { id: { in: authorIds } },
    select: { id: true, name: true },
  });
  // 이메일 폴백 제거(열람자에게 PII 노출 방지) — 표시 이름만.
  const authorName = new Map(authors.map((u) => [u.id, u.name?.trim() || "알 수 없음"]));

  return (
    <main className="py-10">
      <Link href={`/s/${spaceKey}/${encodeURIComponent(slug)}`} className="crumb">
        ← {page.title}
      </Link>
      <h1 className="page-title mt-1.5">변경 이력</h1>
      <ul className="mt-6">
        {page.revisions.map((r) => (
          <li key={r.id} className="row">
            <span className="flex items-baseline gap-3">
              <Link
                href={`/s/${spaceKey}/${encodeURIComponent(slug)}/history/${r.version}`}
                className="key"
                style={{ color: "var(--accent-strong)" }}
              >
                v{r.version}
              </Link>
              <Link
                href={`/s/${spaceKey}/${encodeURIComponent(slug)}/history/${r.version}`}
                className="title-link text-sm"
              >
                {r.title}
              </Link>
            </span>
            <span className="meta">
              {authorName.get(r.authorId) ?? r.authorId} · {r.createdAt.toISOString().slice(0, 16).replace("T", " ")}
              <EditSourceBadge source={r.source} label={r.viaLabel} />
            </span>
          </li>
        ))}
      </ul>
    </main>
  );
}
