import Link from "next/link";
import { notFound } from "next/navigation";
import { listReadableSpaces, requireSpaceRole } from "@/lib/access";
import { prisma } from "@/lib/db";
import { hasRole } from "@/lib/permissions";
import { getRenderedPage } from "@/lib/page-render-cache";
import { WikiArticle } from "@/components/WikiArticle";
import { ArticleToc } from "@/components/ArticleToc";
import { DocumentLayout } from "@/components/DocumentLayout";
import { DocumentSource } from "@/components/DocumentSource";
import { Disclosure } from "@/components/Disclosure";
import { WikiIcon } from "@/components/WikiIcon";
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

  const { space, role, session } = await requireSpaceRole(spaceKey, "viewer");
  const page = await prisma.page.findUnique({
    where: { deletedAt: null, spaceId_slug: { spaceId: space.id, slug } },
  });
  if (!page) notFound();
  const rev = await prisma.pageRevision.findUnique({
    where: { pageId_version: { pageId: page.id, version } },
  });
  if (!rev) notFound();

  const latest = await prisma.pageRevision.aggregate({ where: { pageId: page.id }, _max: { version: true } });
  const isLatest = latest._max.version === version;
  const article = await getRenderedPage({ pageId: page.id, version, spaceId: space.id, spaceKey, content: rev.content, readable: await listReadableSpaces(session) });

  return (
    <DocumentLayout sections={article.sections}>
      <div className="document-toolbar document-toolbar--revision">
        <p className="document-path">revision v{version}{isLatest && " · 최신"}</p>
        <div className="document-actions">
          <Link href={`/s/${spaceKey}/${encodeURIComponent(slug)}/history`} className="btn btn-ghost btn-sm">
            이력으로
          </Link>
          {hasRole(role, "editor") && !isLatest && (
            <form action={restoreRevision.bind(null, spaceKey, slug, version)}>
              <ConfirmSubmitButton message={`v${version} 내용으로 복원할까요? (새 버전으로 저장됩니다)`} className="btn btn-primary btn-sm">
                이 버전으로 복원
              </ConfirmSubmitButton>
            </form>
          )}
          <Disclosure label="문서 더보기" trigger={<WikiIcon name="more" />}>
            <DocumentSource source={rev.content} title={`${rev.title} · v${version}`} />
          </Disclosure>
        </div>
      </div>
      <header className="document-heading">
        <h1 className="document-title">{rev.title}</h1>
        {article.sections.length > 1 && <div className="document-meta-row document-meta-row--toc">
          <ArticleToc sections={article.sections} compact />
        </div>}
      </header>
      <WikiArticle html={article.html} />
    </DocumentLayout>
  );
}
