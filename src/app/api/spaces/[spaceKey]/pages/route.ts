import { NextRequest } from "next/server";
import { requireApiSpaceRole } from "@/lib/api-auth";
import { prisma } from "@/lib/db";

// GET /api/spaces/{spaceKey}/pages — 스페이스의 페이지 목록(제목/slug/수정시각)
export async function GET(req: NextRequest, ctx: { params: Promise<{ spaceKey: string }> }) {
  const { spaceKey } = await ctx.params;
  const auth = await requireApiSpaceRole(req, spaceKey, "viewer");
  if (!auth.ok) return auth.response;

  const pages = await prisma.page.findMany({
    where: { spaceId: auth.space.id },
    orderBy: { updatedAt: "desc" },
    select: { slug: true, title: true, updatedAt: true },
  });
  return Response.json({
    space: { key: auth.space.key, name: auth.space.name },
    pages,
  });
}
