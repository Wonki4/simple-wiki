import { NextRequest } from "next/server";
import { requireApiSpaceRole } from "@/lib/api-auth";
import { appendToPage } from "@/lib/pages";
import { PageConflictError } from "@/lib/page-edits";

// POST /api/spaces/{spaceKey}/pages/{slug}/append — 본문 끝에 마크다운 추가 (editor 권한)
// body: { content: string, expectedVersion?: number }
export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ spaceKey: string; slug: string }> },
) {
  const { spaceKey, slug: rawSlug } = await ctx.params;
  const slug = decodeURIComponent(rawSlug);
  const auth = await requireApiSpaceRole(req, spaceKey, "editor");
  if (!auth.ok) return auth.response;

  let body: { content?: unknown; expectedVersion?: unknown };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "JSON 본문이 올바르지 않습니다." }, { status: 400 });
  }
  const content = typeof body.content === "string" ? body.content : "";
  if (!content.trim()) return Response.json({ error: "content가 비어 있습니다." }, { status: 400 });
  const expectedVersion =
    typeof body.expectedVersion === "number" ? body.expectedVersion : undefined;

  try {
    const result = await appendToPage({
      spaceId: auth.space.id,
      slug,
      authorId: auth.actor.userId,
      source: auth.actor.via === "token" ? "api" : "web",
      viaLabel: auth.actor.via === "token" ? auth.actor.tokenName : null,
      expectedVersion,
      content,
    });
    if (!result.found) return Response.json({ error: "페이지가 없습니다." }, { status: 404 });
    return Response.json({
      slug,
      version: result.version,
      url: `/s/${spaceKey}/${encodeURIComponent(slug)}`,
    });
  } catch (e) {
    if (e instanceof PageConflictError) {
      return Response.json(
        { error: "페이지가 그사이 변경되었습니다.", currentVersion: e.currentVersion },
        { status: 409 },
      );
    }
    return Response.json({ error: e instanceof Error ? e.message : "추가 실패" }, { status: 400 });
  }
}
