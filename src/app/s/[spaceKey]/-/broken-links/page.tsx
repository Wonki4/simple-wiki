import Link from "next/link";
import { SpaceCollectionNav } from "@/components/SpaceCollectionNav";
import { listReadableSpaces, requireSpaceRole } from "@/lib/access";
import { listBrokenWikiLinks } from "@/lib/broken-wiki-links";
import { effectiveSpaceRole, hasRole } from "@/lib/permissions";

export default async function BrokenLinksPage({ params }: { params: Promise<{ spaceKey: string }> }) {
  const { spaceKey } = await params;
  const { session, space, role } = await requireSpaceRole(spaceKey, "viewer");
  const readable = await listReadableSpaces(session);
  const sources = await listBrokenWikiLinks(space, readable);
  const writable = new Set(readable.filter(s => hasRole(effectiveSpaceRole(session, s), "editor")).map(s => s.key));
  const home = `/s/${spaceKey}`;
  const canEditSource = hasRole(role, "editor");
  const total = sources.reduce((sum, source) => sum + source.issues.length, 0);

  return (
    <main className="collection">
      <Link href={home} className="crumb">← {space.name}</Link>
      <header className="collection-heading">
        <h1 className="document-title">깨진 위키링크</h1>
        <p>이 스페이스의 문서에서 연결한 문서나 소제목을 찾을 수 없는 링크입니다. 열람 가능한 스페이스만 확인합니다.</p>
      </header>
      <SpaceCollectionNav spaceKey={space.key} active="broken-links" canEdit={canEditSource} />
      {sources.length === 0 ? <p className="empty-collection">깨진 위키링크가 없습니다.</p> : <>
        <h2 className="collection-label">문서 {sources.length}개 · 깨진 링크 {total}개</h2>
        {sources.map(source => {
          const href = `${home}/${encodeURIComponent(source.slug)}`;
          return <section key={source.slug} className="broken-links-group" aria-label={source.title}>
            <header>
              <h3><Link className="title-link" href={href}>{source.title}</Link></h3>
              {canEditSource && <Link className="linklike text-sm" href={`${href}/edit`}>원본 문서 편집</Link>}
            </header>
            <ul>{source.issues.map(issue => {
              const base = `/s/${issue.spaceKey}`;
              return <li key={issue.target}>
                <div><code>[[{issue.target}]]</code>
                  <p className="meta">{issue.missing === "page" ? "대상 문서를 찾을 수 없음" : "소제목을 찾을 수 없음"}</p>
                </div>
                {issue.missing === "section"
                  ? <Link className="linklike text-sm" href={`${base}/${encodeURIComponent(issue.slug)}`}>대상 문서 열기</Link>
                  : writable.has(issue.spaceKey) && <Link className="linklike text-sm" href={`${base}/new?title=${encodeURIComponent(issue.title)}`}>대상 문서 만들기</Link>}
              </li>;
            })}</ul>
          </section>;
        })}
      </>}
    </main>
  );
}
