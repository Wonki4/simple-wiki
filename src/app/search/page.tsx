import Link from "next/link";
import { listReadableSpaces, requireSession } from "@/lib/access";
import { searchPages } from "@/lib/search";

function Snippet({ text }: { text: string }) {
  // [[HL]]마커[[/HL]] → <mark>. 원문은 React가 이스케이프하므로 안전.
  const parts = text.split(/\[\[HL\]\]|\[\[\/HL\]\]/);
  return (
    <p className="mt-1 text-sm text-gray-600">
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
    <main className="py-8">
      <h1 className="text-2xl font-bold">검색{q ? `: ${q}` : ""}</h1>
      <ul className="mt-6 space-y-4">
        {results.map((r) => (
          <li key={`${r.spaceKey}/${r.slug}`}>
            <span className="text-xs text-gray-400">{r.spaceName}</span>
            <div>
              <Link href={`/s/${r.spaceKey}/${encodeURIComponent(r.slug)}`} className="font-semibold text-blue-600 underline">
                {r.title}
              </Link>
            </div>
            <Snippet text={r.snippet} />
          </li>
        ))}
        {q && results.length === 0 && <li className="text-gray-500">결과가 없습니다.</li>}
        {!q && <li className="text-gray-500">헤더의 검색창에 검색어를 입력하세요.</li>}
      </ul>
    </main>
  );
}
