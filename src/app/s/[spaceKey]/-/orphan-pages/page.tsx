import Link from "next/link";
import { WikiIcon } from "@/components/WikiIcon";
import { listReadableSpaces, requireSpaceRole } from "@/lib/access";
import { listOrphanPages } from "@/lib/orphan-pages";

export default async function OrphanPages({ params }: { params: Promise<{ spaceKey: string }> }) {
  const { spaceKey } = await params;
  const { space, session } = await requireSpaceRole(spaceKey, "viewer");
  const pages = await listOrphanPages(space, await listReadableSpaces(session));
  const home = `/s/${spaceKey}`;
  return (
    <main className="collection">
      <Link href={home} className="crumb">← {space.name}</Link>
      <header className="collection-heading">
        <h1 className="document-title">고아 문서</h1>
        <p>이 스페이스의 문서 중 내가 읽을 수 있는 다른 문서의 본문에서 링크하지 않은 문서입니다.</p>
      </header>
      {pages.length === 0 ? <p className="empty-collection">고아 문서가 없습니다.</p> : <>
        <h2 className="collection-label">고아 문서 {pages.length}개</h2>
        <ul className="recent-list">
          {pages.map(page => (
            <li key={page.slug}>
              <Link href={`${home}/${encodeURIComponent(page.slug)}`}>
                <WikiIcon name="file" /><span>{page.title}</span>
                <time dateTime={page.updatedAt.toISOString()}>{page.updatedAt.toISOString().slice(0, 10)}</time>
              </Link>
            </li>
          ))}
        </ul>
      </>}
    </main>
  );
}
