import Link from "next/link";
import { notFound } from "next/navigation";
import { requireSpaceRole } from "@/lib/access";
import { prisma } from "@/lib/db";
import { hasRole } from "@/lib/permissions";
import { renderMarkdown } from "@/lib/markdown";
import { restoreRevision } from "@/actions/pages";
import { ConfirmSubmitButton } from "@/components/ConfirmSubmitButton";

export default async function RevisionPage({
  params,
}: {
  params: Promise<{ spaceKey: string; slug: string; version: string }>;
}) {
  const { spaceKey, slug: rawSlug, version: versionStr } = await params;
  const slug = decodeURIComponent(rawSlug);
  const version = Number(versionStr);
  if (!Number.isInteger(version) || version < 1) notFound();

  const { space, role } = await requireSpaceRole(spaceKey, "viewer");
  const page = await prisma.page.findUnique({
    where: { spaceId_slug: { spaceId: space.id, slug } },
  });
  if (!page) notFound();
  const rev = await prisma.pageRevision.findUnique({
    where: { pageId_version: { pageId: page.id, version } },
  });
  if (!rev) notFound();

  const latest = await prisma.pageRevision.aggregate({ where: { pageId: page.id }, _max: { version: true } });
  const isLatest = latest._max.version === version;
  const html = await renderMarkdown(rev.content, { spaceKey, existingSlugs: new Set() });

  return (
    <main className="py-8">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">
          {rev.title} <span className="text-gray-400">v{version}{isLatest && " (최신)"}</span>
        </h1>
        <div className="flex gap-2 text-sm">
          <Link href={`/s/${spaceKey}/${encodeURIComponent(slug)}/history`} className="rounded border border-gray-300 px-3 py-1.5">
            이력으로
          </Link>
          {hasRole(role, "editor") && !isLatest && (
            <form action={restoreRevision.bind(null, spaceKey, slug, version)}>
              <ConfirmSubmitButton message={`v${version} 내용으로 복원할까요? (새 버전으로 저장됩니다)`} className="rounded bg-blue-600 px-3 py-1.5 text-white">
                이 버전으로 복원
              </ConfirmSubmitButton>
            </form>
          )}
        </div>
      </div>
      <article className="prose-wiki mt-6" dangerouslySetInnerHTML={{ __html: html }} />
    </main>
  );
}
