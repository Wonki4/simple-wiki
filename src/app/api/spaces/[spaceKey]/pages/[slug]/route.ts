import { NextRequest } from "next/server";
import { requireApiSpaceRole } from "@/lib/api-auth";
import { prisma } from "@/lib/db";

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
    select: { slug: true, title: true, content: true, updatedAt: true },
  });
  if (!page) return Response.json({ error: "페이지가 없습니다." }, { status: 404 });

  return Response.json({
    space: { key: auth.space.key, name: auth.space.name },
    slug: page.slug,
    title: page.title,
    content: page.content,
    updatedAt: page.updatedAt,
  });
}
