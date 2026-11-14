import type { NextRequest } from "next/server";
import { requireApiSpaceRole } from "@/lib/api-auth";
import { renderMarkdown } from "@/lib/markdown";
import { getWikiDestinations } from "@/lib/wiki-link-destinations";

export async function POST(request: NextRequest, ctx: { params: Promise<{ spaceKey: string }> }) {
  const { spaceKey } = await ctx.params;
  const auth = await requireApiSpaceRole(request, spaceKey, "editor");
  if (!auth.ok) return auth.response;

  const body = await request.json().catch(() => null);
  if (typeof body?.content !== "string") {
    return Response.json({ error: "마크다운 본문을 입력하세요." }, { status: 400 });
  }

  const destinations = await getWikiDestinations(auth.space.id);
  const { html } = await renderMarkdown(body.content, { spaceKey, destinations });
  return Response.json({ html }, { headers: { "Cache-Control": "private, no-store" } });
}
