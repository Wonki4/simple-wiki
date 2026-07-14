import { NextRequest } from "next/server";
import { resolveApiActor, rateLimitResponse } from "@/lib/api-auth";
import { listReadableSpaces } from "@/lib/access";
import { searchPages } from "@/lib/search";

// GET /api/search?q=... — 전문 검색. 읽기 권한이 있는 스페이스로만 필터링.
export async function GET(req: NextRequest) {
  const actor = await resolveApiActor(req);
  if (!actor) return Response.json({ error: "인증이 필요합니다." }, { status: 401 });
  const limited = rateLimitResponse(actor);
  if (limited) return limited;

  const q = (req.nextUrl.searchParams.get("q") ?? "").trim();
  if (!q) return Response.json({ query: "", results: [] });

  const spaces = await listReadableSpaces(actor);
  const results = await searchPages(
    q,
    spaces.map((s) => s.id),
  );

  return Response.json({
    query: q,
    results: results.map((r) => ({
      spaceKey: r.spaceKey,
      spaceName: r.spaceName,
      slug: r.slug,
      title: r.title,
      // 하이라이트 마커([[HL]])는 제거하고 평문 스니펫으로 전달
      snippet: r.snippet.replace(/\[\[\/?HL\]\]/g, ""),
    })),
  });
}
