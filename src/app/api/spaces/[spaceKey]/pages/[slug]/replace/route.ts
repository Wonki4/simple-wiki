import { NextRequest } from "next/server";
import { requireApiSpaceRole } from "@/lib/api-auth";
import { replaceInPage } from "@/lib/pages";
import { PageConflictError, ReplaceError } from "@/lib/page-edits";

// POST /api/spaces/{spaceKey}/pages/{slug}/replace — old_string을 정확히 1곳 치환 (editor 권한)
// body: { old_string: string, new_string: string, expectedVersion?: number }
export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ spaceKey: string; slug: string }> },
) {
  const { spaceKey, slug: rawSlug } = await ctx.params;
  const slug = decodeURIComponent(rawSlug);
  const auth = await requireApiSpaceRole(req, spaceKey, "editor");
  if (!auth.ok) return auth.response;

  let body: { old_string?: unknown; new_string?: unknown; expectedVersion?: unknown };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "JSON 본문이 올바르지 않습니다." }, { status: 400 });
  }
  const oldString = typeof body.old_string === "string" ? body.old_string : "";
  const newString = typeof body.new_string === "string" ? body.new_string : "";
  if (!oldString) return Response.json({ error: "old_string이 필요합니다." }, { status: 400 });
  const expectedVersion =
    typeof body.expectedVersion === "number" ? body.expectedVersion : undefined;

  try {
    const result = await replaceInPage({
      spaceId: auth.space.id,
      slug,
      authorId: auth.actor.userId,
      source: auth.actor.via === "token" ? "api" : "web",
      viaLabel: auth.actor.via === "token" ? auth.actor.tokenName : null,
      expectedVersion,
      oldString,
      newString,
    });
    if (!result.found) return Response.json({ error: "페이지가 없습니다." }, { status: 404 });
    return Response.json({
      slug,
      version: result.version,
      url: `/s/${spaceKey}/${encodeURIComponent(slug)}`,
    });
  } catch (e) {
    if (e instanceof ReplaceError) {
      return Response.json({ error: e.message }, { status: 422 });
    }
    if (e instanceof PageConflictError) {
      return Response.json(
        { error: "페이지가 그사이 변경되었습니다.", currentVersion: e.currentVersion },
        { status: 409 },
      );
    }
    return Response.json({ error: e instanceof Error ? e.message : "치환 실패" }, { status: 400 });
  }
}
