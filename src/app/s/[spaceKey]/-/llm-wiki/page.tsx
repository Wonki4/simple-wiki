import { notFound } from "next/navigation";
import { NavigationLink as Link } from "@/components/NavigationLink";
import { SpaceCollectionNav } from "@/components/SpaceCollectionNav";
import { WikiIcon } from "@/components/WikiIcon";
import { requireSpaceRole } from "@/lib/access";
import { listWikiTopics } from "@/lib/llm-wiki";
import { hasRole } from "@/lib/permissions";
import { parseSearchPage, WEB_PAGE_SIZE } from "@/lib/search";
import styles from "./topics.module.css";

export default async function WikiTopicsPage({ params, searchParams }: {
  params: Promise<{ spaceKey: string }>;
  searchParams: Promise<{ q?: string; page?: string }>;
}) {
  const { spaceKey } = await params;
  const { space, role } = await requireSpaceRole(spaceKey, "viewer");
  const query = await searchParams;
  const q = typeof query.q === "string" ? query.q.trim().normalize("NFC") : "";
  const page = parseSearchPage(query.page);
  if (!page || (page - 1) * WEB_PAGE_SIZE > 2147483647 || q.length > 160 || q.includes("\0")) notFound();
  const { topics, nextOffset } = await listWikiTopics(space.id, { q, offset: (page - 1) * WEB_PAGE_SIZE, limit: WEB_PAGE_SIZE });
  const home = `/s/${encodeURIComponent(space.key)}`;
  const wiki = `${home}/-/llm-wiki`;

  function pageHref(n: number) {
    const search = new URLSearchParams();
    if (q) search.set("q", q);
    if (n > 1) search.set("page", String(n));
    return search.size ? `${wiki}?${search}` : wiki;
  }

  return (
    <main className="collection">
      <Link className="document-path" href={home}><WikiIcon name="book" /><span>{space.name}</span></Link>
      <header className="collection-heading">
        <h1 className="document-title">LLM Wiki</h1>
        <p>스페이스 문서에 담긴 현재 기준과 적용 사례, 논의 중인 내용을 주제별로 읽어보세요.</p>
      </header>
      <SpaceCollectionNav spaceKey={space.key} active="llm-wiki" canEdit={hasRole(role, "editor")} />
      {topics.length === 0 && !q && page === 1 ? (
        <div className="empty-collection">
          <h2 className={styles.emptyTitle}>아직 정리된 주제가 없습니다.</h2>
          <p>위키 MCP에 연결된 에이전트가 문서를 저장하고 관련 주제를 정리하면 여기에 표시됩니다.</p>
        </div>
      ) : (
        <>
          <form action={wiki} method="get" className="attachment-search" role="search" aria-label="LLM Wiki 주제 검색">
            <input className="input" type="search" name="q" aria-label="주제 이름" placeholder="주제 이름 검색" defaultValue={q} maxLength={160} />
            <button className="btn btn-ghost btn-sm">검색</button>
            {q && <Link className="linklike" href={wiki}>전체 보기</Link>}
          </form>
          <h2 className="collection-label">{q ? "검색 결과" : "주제 목록"}</h2>
          {topics.length > 0 ? (
            <ul className={styles.topics}>
              {topics.map(topic => (
                <li key={topic.key}>
                  <Link href={`${wiki}/${encodeURIComponent(topic.key)}`} aria-label={topic.title} prefetch={false}>
                    <span className={styles.topicTitle}>{topic.title}</span>
                    <span className={styles.topicMeta}>
                      항목 {topic.itemCount}개 · <time dateTime={topic.updatedAt}>{topic.updatedAt.slice(0, 10)}</time> 갱신
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          ) : <p className="empty-collection">{q ? "일치하는 주제가 없습니다." : "이 페이지에 표시할 주제가 없습니다."}</p>}
          {(page > 1 || nextOffset !== null) && (
            <nav className="search-pagination" aria-label="주제 목록 페이지">
              {page > 1 && <Link rel="prev" href={pageHref(page - 1)}>이전</Link>}
              <span aria-current="page">{page}페이지</span>
              {nextOffset !== null && <Link rel="next" href={pageHref(page + 1)}>다음</Link>}
            </nav>
          )}
        </>
      )}
    </main>
  );
}
