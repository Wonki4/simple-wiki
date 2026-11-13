import { notFound } from "next/navigation";
import { requireSpaceRole } from "@/lib/access";
import { prisma } from "@/lib/db";
import { updatePage } from "@/actions/pages";
import { MarkdownEditor } from "@/components/MarkdownEditor";

export default async function EditPagePage({ params }: { params: Promise<{ spaceKey: string; slug: string }> }) {
  const { spaceKey, slug: rawSlug } = await params;
  const slug = decodeURIComponent(rawSlug);
  const { space } = await requireSpaceRole(spaceKey, "editor");
  const page = await prisma.page.findUnique({
    where: { spaceId_slug: { spaceId: space.id, slug } },
    select: { title: true, content: true, version: true },
  });
  if (!page) notFound();
  return (
    <main className="document" aria-label="문서 편집">
      <MarkdownEditor
        spaceKey={spaceKey}
        spaceName={space.name}
        cancelHref={`/s/${spaceKey}/${encodeURIComponent(slug)}`}
        initialTitle={page.title}
        initialContent={page.content}
        expectedVersion={page.version}
        onSave={updatePage.bind(null, spaceKey, slug)}
      />
    </main>
  );
}
