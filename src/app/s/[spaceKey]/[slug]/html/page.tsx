import { notFound } from "next/navigation";
import { NavigationLink as Link } from "@/components/NavigationLink";
import { requireSpaceRole } from "@/lib/access";
import { prisma } from "@/lib/db";
import { buildHtmlPreview } from "@/lib/html-preview";
import { hasRole } from "@/lib/permissions";
import { HtmlRequestExample } from "./HtmlRequestExample";
import styles from "./preview.module.css";

export default async function HtmlPreviewPage({ params }: {
  params: Promise<{ spaceKey: string; slug: string }>;
}) {
  const { spaceKey, slug: rawSlug } = await params;
  const { space, role } = await requireSpaceRole(spaceKey, "viewer");
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
  if (!page) notFound();
  const preview = page.htmlPreview;
  const documentUrl = `/s/${encodeURIComponent(space.key)}/${encodeURIComponent(slug)}`;

  return (
    <main className={styles.preview}>
      <header className={styles.toolbar}>
        <div className={styles.heading}>
          <p>HTML Viewer{preview && ` · v${preview.baseVersion}`}</p>
          <h1>{page.title}</h1>
        </div>
        <Link href={documentUrl} className="btn btn-ghost btn-sm">마크다운 문서</Link>
      </header>
      {preview && preview.baseVersion !== page.version && (
        <div className="notice notice-warn" role="status">
          이 HTML은 v{preview.baseVersion} 문서를 기준으로 만들었습니다. 현재 문서는 v{page.version}입니다.{" "}
          <Link className={styles.revision} href={`${documentUrl}/history/${preview.baseVersion}`}>기준 버전 보기</Link>
        </div>
      )}
      {preview ? (
        <iframe className={styles.frame} title={`${page.title} HTML Viewer`}
          sandbox="" referrerPolicy="no-referrer" srcDoc={buildHtmlPreview(preview.html)} />
      ) : (
        <section className={styles.empty} aria-labelledby="empty-html-title">
          <h2 id="empty-html-title" className="section-title">아직 저장된 HTML이 없습니다</h2>
          <p>{hasRole(role, "editor")
            ? "위키 MCP에 연결한 에이전트에게 아래처럼 요청하세요. 저장이 끝나면 이 화면을 새로고침해 결과를 볼 수 있습니다."
            : "이 스페이스의 편집자에게 아래 요청을 전달하세요. 편집자가 위키 MCP에 연결한 에이전트로 HTML을 저장하면 여기에서 볼 수 있습니다."}</p>
          <HtmlRequestExample documentPath={`/s/${space.key}/${slug}`} />
        </section>
      )}
    </main>
  );
}
