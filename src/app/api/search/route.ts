import { NextRequest } from "next/server";
import { resolveApiActor, rateLimitResponse } from "@/lib/api-auth";
import { listReadableSpaces } from "@/lib/access";
import { parseSearchPage, searchPages, searchSpaceIds } from "@/lib/search";

export async function GET(req: NextRequest) {
  const actor = await resolveApiActor(req);
  if (!actor) return Response.json({ error: "인증이 필요합니다." }, { status: 401 });
  const limited = rateLimitResponse(actor);
  if (limited) return limited;

  const params = req.nextUrl.searchParams;
  const query = (params.get("q") ?? "").trim();
  const page = parseSearchPage(params.get("page"));
  if (!page) return Response.json({ error: "page는 1 이상의 정수여야 합니다." }, { status: 400 });
  const spaceIds = searchSpaceIds(await listReadableSpaces(actor), params.get("space"));
  if (!spaceIds) return Response.json({ error: "스페이스가 없습니다." }, { status: 404 });

  const { results, ...pagination } = await searchPages(query, spaceIds, page);
  return Response.json({
    query, ...pagination,
    results: results.map(r => ({ ...r, snippet: r.snippet.replace(/\[\[\/?HL\]\]/g, "") })),
  });
}
