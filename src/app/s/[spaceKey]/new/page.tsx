import { requireSpaceRole } from "@/lib/access";
import { createPage } from "@/actions/pages";
import { previewMarkdown } from "@/actions/preview";
import { MarkdownEditor } from "@/components/MarkdownEditor";

export default async function NewPagePage({
  params,
  searchParams,
}: {
  params: Promise<{ spaceKey: string }>;
  searchParams: Promise<{ title?: string }>;
}) {
  const { spaceKey } = await params;
  const { title } = await searchParams;
  await requireSpaceRole(spaceKey, "editor");
  return (
    <main className="py-8">
      <h1 className="mb-4 text-xl font-bold">새 페이지</h1>
      <MarkdownEditor
        spaceKey={spaceKey}
        initialTitle={title ?? ""}
        initialContent=""
        onSave={createPage.bind(null, spaceKey)}
        preview={previewMarkdown.bind(null, spaceKey)}
      />
    </main>
  );
}
