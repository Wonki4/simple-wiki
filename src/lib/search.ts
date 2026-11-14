import { unstable_cache } from "next/cache";
import { prisma } from "@/lib/db";

export interface SearchResult {
  spaceKey: string;
  spaceName: string;
  slug: string;
  title: string;
  snippet: string;
}

const API_PAGE_SIZE = 50;
export const WEB_PAGE_SIZE = 20;

export function parseSearchPage(raw: string | null | undefined): number | null {
  if (raw == null) return 1;
  const page = Number(raw);
  return /^[1-9]\d*$/.test(raw) && Number.isSafeInteger(page) ? page : null;
}

// 범위를 지정했지만 권한이 없으면 전체 검색으로 전환하지 않는다.
export function searchSpaceIds(spaces: { id: string; key: string }[], key?: string | null) {
  if (!key) return spaces.map(s => s.id);
  const selected = spaces.find(s => s.key === key);
  return selected ? [selected.id] : null;
}

export function searchCacheKeyParts(query: string, spaceIds: string[], page = 1, pageSize = API_PAGE_SIZE): string[] {
  return ["search-paged", JSON.stringify({ s: [...spaceIds].sort(), q: query, page, pageSize })];
}

async function runSearch(query: string, spaceIds: string[], requestedPage: number, pageSize: number) {
  // 전체 건수와 페이지를 한 스냅샷에서 읽고, 스니펫은 현재 페이지의 문서에 대해서만 만든다.
  const rows = await prisma.$queryRaw<(SearchResult & { total: bigint })[]>`
    WITH matches AS MATERIALIZED (
      SELECT p.id, ts_rank(p."searchVector", websearch_to_tsquery('simple', ${query})) AS rank
      FROM "Page" p
      WHERE p."deletedAt" IS NULL AND p."spaceId" = ANY(${spaceIds})
        AND (p."searchVector" @@ websearch_to_tsquery('simple', ${query})
          OR p.title ILIKE '%' || ${query} || '%' OR p.content ILIKE '%' || ${query} || '%')
    ), totals AS (SELECT count(*) AS total FROM matches),
    hits AS (
      SELECT id, rank FROM matches ORDER BY rank DESC, id
      LIMIT ${pageSize} OFFSET (
        SELECT LEAST(${requestedPage}::bigint - 1, GREATEST(total - 1, 0) / ${pageSize}::bigint) * ${pageSize} FROM totals
      )
    )
    SELECT s.key AS "spaceKey", s.name AS "spaceName", p.slug, p.title, totals.total,
      ts_headline('simple', p.content, websearch_to_tsquery('simple', ${query}),
        'StartSel=[[HL]],StopSel=[[/HL]],MaxWords=30,MinWords=10') AS snippet
    FROM hits JOIN "Page" p ON p.id = hits.id JOIN "Space" s ON s.id = p."spaceId" CROSS JOIN totals
    ORDER BY hits.rank DESC, hits.id
  `;
  const total = Number(rows[0]?.total ?? 0);
  const totalPages = Math.ceil(total / pageSize);
  return {
    page: Math.min(requestedPage, Math.max(1, totalPages)), pageSize, total, totalPages,
    results: rows.map(({ spaceKey, spaceName, slug, title, snippet }) => ({ spaceKey, spaceName, slug, title, snippet })),
  };
}

export async function searchPages(q: string, spaceIds: string[], page = 1, pageSize = API_PAGE_SIZE) {
  const query = q.trim();
  if (!query || !spaceIds.length) return { page: 1, pageSize, total: 0, totalPages: 0, results: [] as SearchResult[] };
  return unstable_cache(() => runSearch(query, spaceIds, page, pageSize), searchCacheKeyParts(query, spaceIds, page, pageSize), {
    tags: ["page-search"],
    revalidate: 30,
  })();
}
