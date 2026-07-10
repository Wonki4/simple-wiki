import Link from "next/link";
import { listReadableSpaces, requireSession } from "@/lib/access";
import { searchPages } from "@/lib/search";

function Snippet({ text }: { text: string }) {
  // [[HL]]마커[[/HL]] → <mark>. 원문은 React가 이스케이프하므로 안전.
  const parts = text.split(/\[\[HL\]\]|\[\[\/HL\]\]/);
  return (
    <p className="mt-1.5 text-sm leading-relaxed" style={{ color: "var(--ink-2)" }}>
      {parts.map((part, i) => (i % 2 === 1 ? <mark key={i}>{part}</mark> : <span key={i}>{part}</span>))}
    </p>
  );
}

export default async function SearchPage({ searchParams }: { searchParams: Promise<{ q?: string | string[] }> }) {
  const { q: rawQ } = await searchParams;
  const q = Array.isArray(rawQ) ? rawQ[0] : rawQ;
  const session = await requireSession();
  const spaces = await listReadableSpaces(session);
  const results = q ? await searchPages(q, spaces.map((s) => s.id)) : [];

  return (
    <main className="wrap py-10">
      <p className="eyebrow">search</p>
      <h1 className="page-title mt-1">
        {q ? (
          <>
            검색 <span className="faint">/</span> {q}
          </>
        ) : (
          "검색"
        )}
      </h1>
      <ul className="mt-7 grid gap-6">
        {results.map((r) => (
          <li key={`${r.spaceKey}/${r.slug}`}>
            <span className="meta">{r.spaceName}</span>
            <div className="mt-0.5">
              <Link
                href={`/s/${r.spaceKey}/${encodeURIComponent(r.slug)}`}
                className="title-link text-[1.05rem]"
              >
                {r.title}
              </Link>
            </div>
            <Snippet text={r.snippet} />
          </li>
        ))}
        {q && results.length === 0 && <li className="muted">결과가 없습니다.</li>}
        {!q && <li className="muted">헤더의 검색창에 검색어를 입력하세요.</li>}
      </ul>
    </main>
  );
}
