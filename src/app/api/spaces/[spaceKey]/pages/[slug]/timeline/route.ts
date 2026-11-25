import type { NextRequest } from "next/server";
import { requireApiSpaceRole } from "@/lib/api-auth";
import { JsonInputError } from "@/lib/bounded-json";
import { readTimelineInput } from "@/lib/timeline-write-input";
import { saveTimeline } from "@/lib/timeline-write";

export async function PUT(request: NextRequest, ctx: { params: Promise<{ spaceKey: string; slug: string }> }) {
  const { spaceKey, slug: rawSlug } = await ctx.params;
  const auth = await requireApiSpaceRole(request, spaceKey, "editor", { actorPermissionsOnly: true });
  if (!auth.ok) return auth.response;
  let slug: string;
  try {
    slug = decodeURIComponent(rawSlug);
  } catch {
    return Response.json({ error: "페이지 주소가 올바르지 않습니다." }, { status: 400 });
  }
  try {
    const result = await saveTimeline(auth.space.id, slug, await readTimelineInput(request));
    if (!result) return Response.json({ error: "해당 문서 버전이 없습니다." }, { status: 404 });
    return Response.json(result);
  } catch (error) {
    if (error instanceof JsonInputError) return Response.json({ error: error.message }, { status: error.status });
    throw error;
  }
}
