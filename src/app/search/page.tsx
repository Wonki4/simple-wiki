import Link from "next/link";
import { WikiShell } from "@/components/WikiShell";
import { listReadableSpaces, requireSession } from "@/lib/access";
import { searchPages } from "@/lib/search";
import { snippetParts } from "@/lib/search-snippet";

type Params = { q?: string | string[]; from?: string | string[] };

export default async function SearchPage({ searchParams }: { searchParams: Promise<Params> }) {
  const { q: rawQ, from } = await searchParams;
  const q = (Array.isArray(rawQ) ? rawQ[0] : rawQ)?.trim() ?? "";
  const session = await requireSession();
  const spaces = await listReadableSpaces(session);
  const current = spaces.find((s) => s.key === from);
  const results = q ? await searchPages(q, spaces.map((s) => s.id)) : [];

  return (
    <WikiShell session={session} spaces={spaces} current={current}>
      <main className="collection">
        <div className="document-path">전체 스페이스 검색</div>
        <header className="collection-heading">
          <h1 className="document-title">{q || "문서 검색"}</h1>
        </header>
        <h2 className="collection-label">검색 결과{q && ` · ${results.length}${results.length === 50 ? "+" : ""}`}</h2>
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
      </main>
    </WikiShell>
  );
}
