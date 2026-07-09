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
      <main className="py-16 text-center">
        <h1 className="text-xl font-bold">아직 없는 페이지입니다</h1>
        {canEdit ? (
          <Link
            href={`/s/${spaceKey}/new?title=${encodeURIComponent(slug)}`}
            className="mt-4 inline-block rounded bg-blue-600 px-4 py-2 text-sm text-white"
          >
            이 제목으로 페이지 만들기
          </Link>
        ) : (
          <p className="mt-2 text-gray-500">편집 권한이 있는 사용자가 만들 수 있습니다.</p>
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
    <main className="py-8">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-sm text-gray-400">
            <Link href={`/s/${spaceKey}`} className="underline">{space.name}</Link>
          </p>
          <h1 className="text-2xl font-bold">{page.title}</h1>
          <p className="mt-1 text-xs text-gray-400">마지막 수정 {page.updatedAt.toISOString().slice(0, 16).replace("T", " ")}</p>
        </div>
        {canEdit && (
          <div className="flex shrink-0 gap-2 text-sm">
            <Link href={`/s/${spaceKey}/${encodeURIComponent(slug)}/edit`} className="rounded border border-gray-300 px-3 py-1.5">편집</Link>
            <Link href={`/s/${spaceKey}/${encodeURIComponent(slug)}/history`} className="rounded border border-gray-300 px-3 py-1.5">이력</Link>
            <form action={deletePage.bind(null, spaceKey, slug)}>
              <ConfirmSubmitButton message="이 페이지를 삭제할까요?" className="rounded border border-red-300 px-3 py-1.5 text-red-600">
                삭제
              </ConfirmSubmitButton>
            </form>
          </div>
        )}
      </div>

      <article className="prose-wiki mt-6" dangerouslySetInnerHTML={{ __html: html }} />

      {backlinks.length > 0 && (
        <aside className="mt-10 border-t border-gray-200 pt-4">
          <h2 className="text-sm font-semibold text-gray-500">이 페이지를 링크한 문서</h2>
          <ul className="mt-2 space-y-1 text-sm">
            {backlinks.map((b) => (
              <li key={b.id}>
                <Link href={`/s/${spaceKey}/${encodeURIComponent(b.fromPage.slug)}`} className="text-blue-600 underline">
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
