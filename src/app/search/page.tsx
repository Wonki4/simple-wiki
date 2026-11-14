import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { WikiShell } from "@/components/WikiShell";
import { listReadableSpaces, requireSession } from "@/lib/access";
import { parseSearchPage, searchPages, searchSpaceIds, WEB_PAGE_SIZE } from "@/lib/search";
import { snippetParts } from "@/lib/search-snippet";

type Params = Partial<Record<"q" | "from" | "space" | "page", string | string[]>>;
function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export default async function SearchPage({ searchParams }: { searchParams: Promise<Params> }) {
  const params = await searchParams;
  const q = first(params.q)?.trim() ?? "";
  const scope = first(params.space);
  const session = await requireSession();
  const spaces = await listReadableSpaces(session);
  const ids = searchSpaceIds(spaces, scope);
  if (!ids) notFound();
  const selected = spaces.find(s => s.key === scope);
  const origin = spaces.find(s => s.key === first(params.from));
  const requested = parseSearchPage(first(params.page));
  const { results, total, page, totalPages } = await searchPages(q, ids, requested ?? 1, WEB_PAGE_SIZE);

  function pageHref(n: number) {
    const search = new URLSearchParams({ q });
    if (selected) search.set("space", selected.key);
    if (origin) search.set("from", origin.key);
    if (n > 1) search.set("page", String(n));
    return `/search?${search}`;
  }
  if (requested !== page) redirect(pageHref(page));

  return (
    <WikiShell session={session} spaces={spaces} current={selected ?? origin}>
      <main className="collection">
        <div className="document-path">{selected ? `${selected.name} 검색` : "전체 스페이스 검색"}</div>
        <header className="collection-heading">
          <h1 className="document-title">{q || "문서 검색"}</h1>
        </header>
        <form action="/search" method="get" className="search-scope">
          <input type="hidden" name="q" value={q} />
          {origin && <input type="hidden" name="from" value={origin.key} />}
          <label htmlFor="search-scope">검색 범위</label>
          <select key={scope} id="search-scope" name="space" defaultValue={scope ?? ""}>
            <option value="">전체 스페이스</option>
            {spaces.map(s => <option key={s.key} value={s.key}>{s.name}</option>)}
          </select>
          <button className="btn btn-ghost btn-sm">적용</button>
        </form>
        <h2 className="collection-label">검색 결과{q && ` · ${total.toLocaleString("ko-KR")}건`}</h2>
        {results.length ? (
          <ul className="results-list">
            {results.map((r) => (
              <li key={`${r.spaceKey}/${r.slug}`}>
                <p className="document-meta">{r.spaceName}</p>
                <Link href={`/s/${r.spaceKey}/${encodeURIComponent(r.slug)}`} className="title-link">{r.title}</Link>
                <p className="result-excerpt">{snippetParts(r.snippet).map(({ value, highlighted }, i) =>
                  highlighted ? <mark key={i}>{value}</mark> : value
                )}</p>
              </li>
            ))}
          </ul>
        ) : <p className="empty-collection">{q ? "결과가 없습니다." : "검색창에 검색어를 입력하세요."}</p>}
        {totalPages > 1 && (
          <nav className="search-pagination" aria-label="검색 결과 페이지">
            {page > 1 && <Link rel="prev" href={pageHref(page - 1)}>이전</Link>}
            <span aria-current="page">{page} / {totalPages} 페이지</span>
            {page < totalPages && <Link rel="next" href={pageHref(page + 1)}>다음</Link>}
          </nav>
        )}
      </main>
    </WikiShell>
  );
}
