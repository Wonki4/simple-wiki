import { NextRequest } from "next/server";
import { requireApiSpaceRole } from "@/lib/api-auth";
import { prisma } from "@/lib/db";
import { createPageInSpace } from "@/lib/pages";

// GET /api/spaces/{spaceKey}/pages — 스페이스의 페이지 목록(제목/slug/수정시각)
export async function GET(req: NextRequest, ctx: { params: Promise<{ spaceKey: string }> }) {
  const { spaceKey } = await ctx.params;
  const auth = await requireApiSpaceRole(req, spaceKey, "viewer");
  if (!auth.ok) return auth.response;

  const pages = await prisma.page.findMany({
    where: { spaceId: auth.space.id },
    orderBy: { title: "asc" },
    select: { slug: true, title: true, updatedAt: true, parent: { select: { slug: true } } },
  });
  return Response.json({
    space: { key: auth.space.key, name: auth.space.name },
    pages: pages.map((p) => ({
      slug: p.slug,
      title: p.title,
      updatedAt: p.updatedAt,
      parentSlug: p.parent?.slug ?? null,
    })),
  });
}

// POST /api/spaces/{spaceKey}/pages — 새 페이지 생성 (editor 권한)
// body: { title: string, content?: string }
export async function POST(req: NextRequest, ctx: { params: Promise<{ spaceKey: string }> }) {
  const { spaceKey } = await ctx.params;
  const auth = await requireApiSpaceRole(req, spaceKey, "editor");
  if (!auth.ok) return auth.response;

  let body: { title?: unknown; content?: unknown; parent?: unknown };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "JSON 본문이 올바르지 않습니다." }, { status: 400 });
  }
  const title = typeof body.title === "string" ? body.title : "";
  const content = typeof body.content === "string" ? body.content : "";

  const parentSlug = typeof body.parent === "string" && body.parent !== "" ? body.parent : null;
  let parentId: string | null = null;
  if (parentSlug) {
    const parent = await prisma.page.findUnique({
      where: { spaceId_slug: { spaceId: auth.space.id, slug: parentSlug } },
      select: { id: true },
    });
    if (!parent) {
      return Response.json({ error: "부모 문서가 없습니다." }, { status: 422 });
    }
    parentId = parent.id;
  }

  let result;
  try {
    result = await createPageInSpace({
      spaceId: auth.space.id,
      title,
      content,
      authorId: auth.actor.userId,
      source: auth.actor.via === "token" ? "api" : "web",
      viaLabel: auth.actor.via === "token" ? auth.actor.tokenName : null,
      parentId,
    });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : "생성 실패" }, { status: 400 });
  }
  if (!result.created) {
    return Response.json(
      { error: "같은 제목의 페이지가 이미 있습니다.", slug: result.slug },
      { status: 409 },
    );
  }
  return Response.json(
    {
      space: { key: auth.space.key },
      slug: result.slug,
      title: title.trim(),
      url: `/s/${spaceKey}/${encodeURIComponent(result.slug)}`,
    },
    { status: 201 },
  );
}
