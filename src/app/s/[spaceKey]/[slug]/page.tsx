import Link from "next/link";
import { requireSpaceRole } from "@/lib/access";
import { prisma } from "@/lib/db";
import { hasRole } from "@/lib/permissions";
import { renderMarkdown } from "@/lib/markdown";
import { extractWikiLinks } from "@/lib/wiki-links";
import { deletePage } from "@/actions/pages";
import { ConfirmSubmitButton } from "@/components/ConfirmSubmitButton";

export default async function PageView({ params }: { params: Promise<{ spaceKey: string; slug: string }> }) {
  const { spaceKey, slug: rawSlug } = await params;
  const slug = decodeURIComponent(rawSlug);
  const { space, role } = await requireSpaceRole(spaceKey, "viewer");
  const canEdit = hasRole(role, "editor");

  const page = await prisma.page.findUnique({
    where: { spaceId_slug: { spaceId: space.id, slug } },
  });

  if (!page) {
    return (
      <main className="py-20 text-center">
        <p className="eyebrow">404</p>
        <h1 className="page-title mt-3">아직 없는 페이지입니다</h1>
        {canEdit ? (
          <Link
            href={`/s/${spaceKey}/new?title=${encodeURIComponent(slug)}`}
            className="btn btn-primary mt-5 inline-flex"
          >
            이 제목으로 페이지 만들기
          </Link>
        ) : (
          <p className="muted mt-3">편집 권한이 있는 사용자가 만들 수 있습니다.</p>
        )}
      </main>
    );
  }

  const targets = extractWikiLinks(page.content).map((l) => l.slug);
  const existing = targets.length
    ? await prisma.page.findMany({
        where: { spaceId: space.id, slug: { in: targets } },
        select: { slug: true },
      })
    : [];
  const html = await renderMarkdown(page.content, {
    spaceKey,
    existingSlugs: new Set(existing.map((p) => p.slug)),
  });

  const backlinks = await prisma.pageLink.findMany({
    where: { toSpaceId: space.id, toSlug: slug },
    include: { fromPage: { select: { title: true, slug: true } } },
  });

  return (
    <main className="py-10">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <Link href={`/s/${spaceKey}`} className="crumb">
            {space.key} / {space.name}
          </Link>
          <h1 className="page-title mt-1.5">{page.title}</h1>
          <p className="meta mt-2">
            마지막 수정 {page.updatedAt.toISOString().slice(0, 16).replace("T", " ")}
          </p>
        </div>
        {canEdit && (
          <div className="flex shrink-0 gap-2">
            <Link href={`/s/${spaceKey}/${encodeURIComponent(slug)}/edit`} className="btn btn-ghost btn-sm">편집</Link>
            <Link href={`/s/${spaceKey}/${encodeURIComponent(slug)}/history`} className="btn btn-ghost btn-sm">이력</Link>
            <form action={deletePage.bind(null, spaceKey, slug)}>
              <ConfirmSubmitButton message="이 페이지를 삭제할까요?" className="btn btn-danger btn-sm">
                삭제
              </ConfirmSubmitButton>
            </form>
          </div>
        )}
      </div>

      <article className="prose-wiki mt-7" dangerouslySetInnerHTML={{ __html: html }} />

      {backlinks.length > 0 && (
        <aside className="mt-12 border-t pt-5">
          <h2 className="eyebrow">이 페이지를 링크한 문서</h2>
          <ul className="mt-3 grid gap-1.5 text-sm">
            {backlinks.map((b) => (
              <li key={b.id}>
                <Link href={`/s/${spaceKey}/${encodeURIComponent(b.fromPage.slug)}`} className="title-link">
                  {b.fromPage.title}
                </Link>
              </li>
            ))}
          </ul>
        </aside>
      )}
    </main>
  );
}
