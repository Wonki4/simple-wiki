import { NextRequest } from "next/server";
import { requireApiSpaceRole } from "@/lib/api-auth";
import { prisma } from "@/lib/db";
import { updatePageInSpace, deletePageInSpace } from "@/lib/pages";
import { PageConflictError } from "@/lib/page-edits";

// GET /api/spaces/{spaceKey}/pages/{slug} — 페이지 마크다운 원문
export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ spaceKey: string; slug: string }> },
) {
  const { spaceKey, slug: rawSlug } = await ctx.params;
  const slug = decodeURIComponent(rawSlug);
  const auth = await requireApiSpaceRole(req, spaceKey, "viewer");
  if (!auth.ok) return auth.response;

  const page = await prisma.page.findUnique({
    where: { spaceId_slug: { spaceId: auth.space.id, slug } },
    select: { id: true, slug: true, title: true, content: true, version: true, updatedAt: true },
  });
  if (!page) return Response.json({ error: "페이지가 없습니다." }, { status: 404 });

  // ?version=N — 특정 리비전 원문
  const versionParam = req.nextUrl.searchParams.get("version");
  if (versionParam !== null) {
    const version = Number(versionParam);
    if (!Number.isInteger(version) || version < 1) {
      return Response.json({ error: "version이 올바르지 않습니다." }, { status: 400 });
    }
    const rev = await prisma.pageRevision.findUnique({
      where: { pageId_version: { pageId: page.id, version } },
      select: { version: true, title: true, content: true, source: true, viaLabel: true, createdAt: true },
    });
    if (!rev) return Response.json({ error: "해당 버전이 없습니다." }, { status: 404 });
    return Response.json({
      space: { key: auth.space.key, name: auth.space.name },
      slug: page.slug,
      title: rev.title,
      content: rev.content,
      version: rev.version,
      source: rev.source,
      viaLabel: rev.viaLabel,
      createdAt: rev.createdAt,
    });
  }

  return Response.json({
    space: { key: auth.space.key, name: auth.space.name },
    slug: page.slug,
    title: page.title,
    content: page.content,
    version: page.version,
    updatedAt: page.updatedAt,
  });
}

// PUT /api/spaces/{spaceKey}/pages/{slug} — 페이지 수정 (editor 권한)
// body: { title: string, content?: string } — slug는 유지되고 새 리비전이 남는다
export async function PUT(
  req: NextRequest,
  ctx: { params: Promise<{ spaceKey: string; slug: string }> },
) {
  const { spaceKey, slug: rawSlug } = await ctx.params;
  const slug = decodeURIComponent(rawSlug);
  const auth = await requireApiSpaceRole(req, spaceKey, "editor");
  if (!auth.ok) return auth.response;

  let body: { title?: unknown; content?: unknown; expectedVersion?: unknown };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "JSON 본문이 올바르지 않습니다." }, { status: 400 });
  }
  const title = typeof body.title === "string" ? body.title : "";
  const content = typeof body.content === "string" ? body.content : "";
  const expectedVersion =
    typeof body.expectedVersion === "number" ? body.expectedVersion : undefined;

  let result: { found: boolean; version?: number };
  try {
    result = await updatePageInSpace({
      spaceId: auth.space.id,
      slug,
      title,
      content,
      authorId: auth.actor.userId,
      source: auth.actor.via === "token" ? "api" : "web",
      viaLabel: auth.actor.via === "token" ? auth.actor.tokenName : null,
      expectedVersion,
    });
  } catch (e) {
    if (e instanceof PageConflictError) {
      return Response.json(
        { error: "페이지가 그사이 변경되었습니다.", currentVersion: e.currentVersion },
        { status: 409 },
      );
    }
    return Response.json({ error: e instanceof Error ? e.message : "수정 실패" }, { status: 400 });
  }
  if (!result.found) return Response.json({ error: "페이지가 없습니다." }, { status: 404 });

  return Response.json({
    space: { key: auth.space.key },
    slug,
    title: title.trim(),
    version: result.version,
    url: `/s/${spaceKey}/${encodeURIComponent(slug)}`,
  });
}

// DELETE /api/spaces/{spaceKey}/pages/{slug} — 페이지 삭제 (editor 권한)
export async function DELETE(
  req: NextRequest,
  ctx: { params: Promise<{ spaceKey: string; slug: string }> },
) {
  const { spaceKey, slug: rawSlug } = await ctx.params;
  const slug = decodeURIComponent(rawSlug);
  const auth = await requireApiSpaceRole(req, spaceKey, "editor");
  if (!auth.ok) return auth.response;

  const result = await deletePageInSpace({ spaceId: auth.space.id, slug });
  if (!result.found) return Response.json({ error: "페이지가 없습니다." }, { status: 404 });
  return Response.json({ deleted: true, slug });
}
