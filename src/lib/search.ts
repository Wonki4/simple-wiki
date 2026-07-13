import { unstable_cache } from "next/cache";
import { prisma } from "@/lib/db";

export interface SearchResult {
  spaceKey: string;
  spaceName: string;
  slug: string;
  title: string;
  snippet: string;
}

// 캐시 키 파트: 권한 격리를 위해 정렬된 readableSpaceIds + query를 포함한다.
// 같은 스페이스 집합을 읽을 수 있는 사용자끼리만 캐시를 공유한다.
export function searchCacheKeyParts(query: string, spaceIds: string[]): string[] {
  return ["search", [...spaceIds].sort().join(","), query];
}

// 실제 검색 쿼리. ts_headline(스니펫 생성, CPU)을 서브쿼리로 상위 50행에만 적용한다.
async function runSearch(query: string, readableSpaceIds: string[]): Promise<SearchResult[]> {
  return prisma.$queryRaw<SearchResult[]>`
    SELECT
      hit."spaceKey",
      hit."spaceName",
      hit."slug",
      hit."title",
      ts_headline(
        'simple', hit."content", websearch_to_tsquery('simple', ${query}),
        'StartSel=[[HL]],StopSel=[[/HL]],MaxWords=30,MinWords=10'
      ) AS "snippet"
    FROM (
      SELECT
        s."key"  AS "spaceKey",
        s."name" AS "spaceName",
        p."slug",
        p."title",
        p."content"
      FROM "Page" p
      JOIN "Space" s ON s."id" = p."spaceId"
      WHERE p."spaceId" = ANY(${readableSpaceIds})
        AND (
          p."searchVector" @@ websearch_to_tsquery('simple', ${query})
          OR p."title" ILIKE '%' || ${query} || '%'
          OR p."content" ILIKE '%' || ${query} || '%'
        )
      ORDER BY ts_rank(p."searchVector", websearch_to_tsquery('simple', ${query})) DESC
      LIMIT 50
    ) hit
  `;
}

export async function searchPages(q: string, readableSpaceIds: string[]): Promise<SearchResult[]> {
  const query = q.trim();
  if (!query || readableSpaceIds.length === 0) return [];
  // 검색 결과를 30초 캐시. 권한 격리 키로 캐시 공유를 제한한다.
  const cached = unstable_cache(() => runSearch(query, readableSpaceIds), searchCacheKeyParts(query, readableSpaceIds), {
    revalidate: 30,
  });
  return cached();
}
