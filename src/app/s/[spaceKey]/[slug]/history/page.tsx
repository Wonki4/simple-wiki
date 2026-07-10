import Link from "next/link";
import { notFound } from "next/navigation";
import { requireSpaceRole } from "@/lib/access";
import { prisma } from "@/lib/db";

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
  const authors = await prisma.user.findMany({ where: { id: { in: authorIds } } });
  const authorName = new Map(authors.map((u) => [u.id, u.name || u.email]));

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
              <span className="text-sm" style={{ color: "var(--ink-2)" }}>{r.title}</span>
            </span>
            <span className="meta">
              {authorName.get(r.authorId) ?? r.authorId} · {r.createdAt.toISOString().slice(0, 16).replace("T", " ")}
            </span>
          </li>
        ))}
      </ul>
    </main>
  );
}
