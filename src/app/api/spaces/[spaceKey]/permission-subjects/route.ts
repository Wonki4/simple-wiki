import type { NextRequest } from "next/server";
import { requireApiSpaceRole } from "@/lib/api-auth";
import { searchPermissionSubjects } from "@/lib/permission-search";

const headers = { "Cache-Control": "private, no-store" };

export async function GET(request: NextRequest, ctx: { params: Promise<{ spaceKey: string }> }) {
  const { spaceKey } = await ctx.params;
  const auth = await requireApiSpaceRole(request, spaceKey, "admin", { actorPermissionsOnly: true });
  if (!auth.ok) return auth.response;
  const query = (request.nextUrl.searchParams.get("q") ?? "").trim();
  if (query.length > 100) return Response.json({ error: "검색어는 100자 이내로 입력하세요." }, { status: 400, headers });
  try {
    return Response.json(await searchPermissionSubjects(auth.space.id, query), { headers });
  } catch (error) {
    const code = (error as { code?: string; meta?: { code?: string } })?.meta?.code;
    if (code === "57014" || ["P2024", "P2028"].includes((error as { code?: string })?.code ?? "")) {
      return Response.json({ error: "검색이 지연되고 있습니다. 검색어를 더 구체적으로 입력해 주세요." }, { status: 503, headers });
    }
    throw error;
  }
}
