import { requireSpaceRole } from "@/lib/access";
import { prisma } from "@/lib/db";
import { createPage } from "@/actions/pages";
import { MarkdownEditor } from "@/components/MarkdownEditor";

export default async function NewPagePage({
  params,
  searchParams,
}: {
  params: Promise<{ spaceKey: string }>;
  searchParams: Promise<{ title?: string; parent?: string; error?: string }>;
}) {
  const { spaceKey } = await params;
  const { title, parent, error } = await searchParams;
  const { space } = await requireSpaceRole(spaceKey, "editor");

  // 부모 문서 확인 — 없으면(잘못된 링크 등) 최상위 생성으로 조용히 폴백하지 않고 안내만 남긴다.
  const parentPage = parent
    ? await prisma.page.findUnique({
        where: { spaceId_slug: { spaceId: space.id, slug: parent } },
        select: { slug: true, title: true },
      })
    : null;

  return (
    <main className="document" aria-label="새 문서">
      {error && (
        <div className="notice notice-warn mb-4" role="alert">
          {error}
        </div>
      )}
      {parentPage && (
        <p className="meta mb-4">&apos;{parentPage.title}&apos; 하위에 만듭니다.</p>
      )}
      <MarkdownEditor
        spaceKey={spaceKey}
        spaceName={space.name}
        cancelHref={parentPage ? `/s/${spaceKey}/${encodeURIComponent(parentPage.slug)}` : `/s/${spaceKey}`}
        initialTitle={title ?? ""}
        initialContent=""
        onSave={createPage.bind(null, spaceKey, parentPage?.slug ?? null)}
      />
    </main>
  );
}
