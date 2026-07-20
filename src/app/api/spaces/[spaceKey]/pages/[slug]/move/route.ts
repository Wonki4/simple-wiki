import { NextRequest } from "next/server";
import { requireApiSpaceRole } from "@/lib/api-auth";
import { movePageInSpace } from "@/lib/pages";

// POST /api/spaces/{spaceKey}/pages/{slug}/move — 트리 이동 (editor 권한)
// body: { parent: string | null }  — parent는 부모 slug, null이면 최상위.
export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ spaceKey: string; slug: string }> },
) {
  const { spaceKey, slug: rawSlug } = await ctx.params;
  const slug = decodeURIComponent(rawSlug);
  const auth = await requireApiSpaceRole(req, spaceKey, "editor");
  if (!auth.ok) return auth.response;

  let body: { parent?: unknown };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "JSON 본문이 올바르지 않습니다." }, { status: 400 });
  }
  const parentSlug =
    body.parent === null || body.parent === undefined || body.parent === ""
      ? null
      : typeof body.parent === "string"
        ? body.parent
        : undefined;
  if (parentSlug === undefined) {
    return Response.json({ error: "parent는 문자열 slug 또는 null이어야 합니다." }, { status: 400 });
  }

  const result = await movePageInSpace({ spaceId: auth.space.id, slug, parentSlug });
  if (!result.ok) {
    if (result.reason === "not-found") return Response.json({ error: "없습니다." }, { status: 404 });
    const msg = result.reason === "cycle" ? "자기 자신이나 하위 문서로는 이동할 수 없습니다." : "부모 문서가 없습니다.";
    return Response.json({ error: msg }, { status: 422 });
  }
  return Response.json({ moved: true, slug, parent: parentSlug });
}
