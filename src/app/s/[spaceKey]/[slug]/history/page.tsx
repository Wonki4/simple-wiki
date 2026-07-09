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
    <main className="py-8">
      <h1 className="text-xl font-bold">
        <Link href={`/s/${spaceKey}/${encodeURIComponent(slug)}`} className="underline">{page.title}</Link>
        {" "}이력
      </h1>
      <ul className="mt-6 space-y-1 text-sm">
        {page.revisions.map((r) => (
          <li key={r.id} className="flex items-baseline gap-4 border-b border-gray-100 py-2">
            <Link
              href={`/s/${spaceKey}/${encodeURIComponent(slug)}/history/${r.version}`}
              className="text-blue-600 underline"
            >
              v{r.version}
            </Link>
            <span>{r.title}</span>
            <span className="ml-auto text-gray-400">
              {authorName.get(r.authorId) ?? r.authorId} · {r.createdAt.toISOString().slice(0, 16).replace("T", " ")}
            </span>
          </li>
        ))}
      </ul>
    </main>
  );
}
