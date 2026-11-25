import { notFound } from "next/navigation";
import { NavigationLink as Link } from "@/components/NavigationLink";
import { requireSpaceRole } from "@/lib/access";
import { prisma } from "@/lib/db";
import { buildHtmlPreview } from "@/lib/html-preview";
import styles from "./preview.module.css";

export default async function HtmlPreviewPage({ params }: {
  params: Promise<{ spaceKey: string; slug: string }>;
}) {
  const { spaceKey, slug: rawSlug } = await params;
  const { space } = await requireSpaceRole(spaceKey, "viewer");
  let slug: string;
  try {
    slug = decodeURIComponent(rawSlug);
  } catch {
    notFound();
  }
  const page = await prisma.page.findUnique({
    where: { spaceId_slug: { spaceId: space.id, slug }, deletedAt: null },
    select: { title: true, version: true, htmlPreview: { select: { html: true, baseVersion: true } } },
  });
  if (!page?.htmlPreview) notFound();
  const preview = page.htmlPreview;
  const documentUrl = `/s/${encodeURIComponent(space.key)}/${encodeURIComponent(slug)}`;

  return (
    <main className={styles.preview}>
      <header className={styles.toolbar}>
        <div className={styles.heading}>
          <p>HTML 미리보기 · v{preview.baseVersion}</p>
          <h1>{page.title}</h1>
        </div>
        <Link href={documentUrl} className="btn btn-ghost btn-sm">마크다운 문서</Link>
      </header>
      {preview.baseVersion !== page.version && (
        <div className="notice notice-warn" role="status">
          이 미리보기는 v{preview.baseVersion} 문서를 기준으로 만들었습니다. 현재 문서는 v{page.version}입니다.{" "}
          <Link className={styles.revision} href={`${documentUrl}/history/${preview.baseVersion}`}>기준 버전 보기</Link>
        </div>
      )}
      <iframe className={styles.frame} title={`${page.title} HTML 미리보기`}
        sandbox="" referrerPolicy="no-referrer" srcDoc={buildHtmlPreview(preview.html)} />
    </main>
  );
}
