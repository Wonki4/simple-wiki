import { notFound } from "next/navigation";
import { requireSpaceRole } from "@/lib/access";
import { prisma } from "@/lib/db";
import { updatePage } from "@/actions/pages";
import { previewMarkdown } from "@/actions/preview";
import { MarkdownEditor } from "@/components/MarkdownEditor";

export default async function EditPagePage({ params }: { params: Promise<{ spaceKey: string; slug: string }> }) {
  const { spaceKey, slug: rawSlug } = await params;
  const slug = decodeURIComponent(rawSlug);
  const { space } = await requireSpaceRole(spaceKey, "editor");
  const page = await prisma.page.findUnique({
    where: { spaceId_slug: { spaceId: space.id, slug } },
  });
  if (!page) notFound();
  return (
    <main className="py-8">
      <h1 className="mb-4 text-xl font-bold">페이지 편집</h1>
      <MarkdownEditor
        spaceKey={spaceKey}
        initialTitle={page.title}
        initialContent={page.content}
        onSave={updatePage.bind(null, spaceKey, slug)}
        preview={previewMarkdown.bind(null, spaceKey)}
      />
    </main>
  );
}
