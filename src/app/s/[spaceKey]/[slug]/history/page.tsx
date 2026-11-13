import Link from "next/link";
import { notFound } from "next/navigation";
import { requireSpaceRole } from "@/lib/access";
import { prisma } from "@/lib/db";
import { RevisionComparison } from "@/components/RevisionComparison";
import { EditSourceBadge } from "@/components/EditSourceBadge";

export default async function HistoryPage({ params, searchParams }: {
  params: Promise<{ spaceKey: string; slug: string }>;
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  const { spaceKey, slug: rawSlug } = await params;
  const slug = decodeURIComponent(rawSlug);
  const { space } = await requireSpaceRole(spaceKey, "viewer");
  const page = await prisma.page.findUnique({
    where: { deletedAt: null, spaceId_slug: { spaceId: space.id, slug } },
    select: { id: true, title: true, revisions: {
      orderBy: { version: "desc" },
      select: { id: true, version: true, title: true, authorId: true, createdAt: true, source: true, viaLabel: true },
    } },
  });
  if (!page) notFound();

  const query = await searchParams;
  const comparing = query.from !== undefined || query.to !== undefined;
  const from = Number(query.from);
  const to = Number(query.to);
  const selected = comparing && [from, to].every(v => page.revisions.some(r => r.version === v))
    ? await prisma.pageRevision.findMany({
        where: { pageId: page.id, version: { in: [from, to] } },
        select: { version: true, title: true, content: true },
      })
    : [];
  const before = selected.find(r => r.version === from);
  const after = selected.find(r => r.version === to);

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
      {page.revisions.length > 1 && (
        <form method="get" className="diff-picker">
          <label>기준 버전 <select name="from" defaultValue={before?.version ?? page.revisions[1].version}>
            {page.revisions.map(r => <option key={r.version} value={r.version}>v{r.version}</option>)}
          </select></label>
          <label>비교 버전 <select name="to" defaultValue={after?.version ?? page.revisions[0].version}>
            {page.revisions.map(r => <option key={r.version} value={r.version}>v{r.version}</option>)}
          </select></label>
          <button className="btn btn-primary btn-sm">버전 비교</button>
        </form>
      )}
      {comparing && (before && after ? <RevisionComparison from={before} to={after} />
        : <p className="notice notice-warn" role="alert">이 문서에 있는 두 버전을 선택하세요.</p>)}
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
