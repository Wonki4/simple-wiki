import { prisma } from "@/lib/db";

export interface SearchResult {
  spaceKey: string;
  spaceName: string;
  slug: string;
  title: string;
  snippet: string;
}

export async function searchPages(q: string, readableSpaceIds: string[]): Promise<SearchResult[]> {
  const query = q.trim();
  if (!query || readableSpaceIds.length === 0) return [];
  return prisma.$queryRaw<SearchResult[]>`
    SELECT
      s."key"  AS "spaceKey",
      s."name" AS "spaceName",
      p."slug",
      p."title",
      ts_headline(
        'simple', p."content", websearch_to_tsquery('simple', ${query}),
        'StartSel=[[HL]],StopSel=[[/HL]],MaxWords=30,MinWords=10'
      ) AS "snippet"
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
  `;
}
