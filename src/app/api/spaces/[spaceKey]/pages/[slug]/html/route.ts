import type { NextRequest } from "next/server";
import { requireApiSpaceRole } from "@/lib/api-auth";
import { PageConflictError } from "@/lib/page-edits";
import { savePageHtml } from "@/lib/page-html";
import { PageHtmlInputError, readPageHtmlInput } from "@/lib/page-html-input";

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
    const { html, baseVersion } = await readPageHtmlInput(request);
    const found = await savePageHtml({ spaceId: auth.space.id, slug, html, baseVersion });
    if (!found) return Response.json({ error: "페이지가 없습니다." }, { status: 404 });
    return Response.json({ baseVersion, previewUrl: `/s/${encodeURIComponent(spaceKey)}/${encodeURIComponent(slug)}/html` });
  } catch (error) {
    if (error instanceof PageHtmlInputError) return Response.json({ error: error.message }, { status: error.status });
    if (error instanceof PageConflictError) {
      return Response.json({ error: error.message, currentVersion: error.currentVersion }, { status: 409 });
    }
    throw error;
  }
}
