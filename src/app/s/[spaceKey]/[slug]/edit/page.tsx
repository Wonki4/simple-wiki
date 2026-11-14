import { notFound } from "next/navigation";
import { requireSpaceRole } from "@/lib/access";
import { prisma } from "@/lib/db";
import { updatePage } from "@/actions/pages";
import { MarkdownEditor } from "@/components/MarkdownEditor";

export default async function EditPagePage({ params }: { params: Promise<{ spaceKey: string; slug: string }> }) {
  const { spaceKey, slug: rawSlug } = await params;
  const slug = decodeURIComponent(rawSlug);
  const { space, session } = await requireSpaceRole(spaceKey, "editor");
  const page = await prisma.page.findUnique({
    where: { deletedAt: null, spaceId_slug: { spaceId: space.id, slug } },
    select: { id: true, title: true, content: true, version: true },
  });
  if (!page) notFound();
  const draftKey = `simple-wiki:draft:${JSON.stringify([session.userId, space.id, "edit", page.id])}`;
  return (
    <main className="document" aria-label="문서 편집">
      <MarkdownEditor
        key={draftKey}
        draftKey={draftKey}
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
