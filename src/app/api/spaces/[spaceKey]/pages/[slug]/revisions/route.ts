import { NextRequest } from "next/server";
import { requireApiSpaceRole } from "@/lib/api-auth";
import { prisma } from "@/lib/db";

// GET /api/spaces/{spaceKey}/pages/{slug}/revisions — 리비전 메타 목록(본문 제외, 최신순)
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
    select: { id: true },
  });
  if (!page) return Response.json({ error: "페이지가 없습니다." }, { status: 404 });

  const revisions = await prisma.pageRevision.findMany({
    where: { pageId: page.id },
    orderBy: { version: "desc" },
    take: 100,
    select: { version: true, title: true, source: true, viaLabel: true, createdAt: true, authorId: true },
  });
  // 이메일은 노출하지 않는다(PII). 표시 이름만.
  const authorIds = [...new Set(revisions.map((r) => r.authorId))];
  const users = await prisma.user.findMany({
    where: { id: { in: authorIds } },
    select: { id: true, name: true },
  });
  const nameById = new Map(users.map((u) => [u.id, u.name?.trim() || "알 수 없음"]));

  return Response.json({
    slug,
    revisions: revisions.map((r) => ({
      version: r.version,
      title: r.title,
      author: nameById.get(r.authorId) ?? "알 수 없음",
      source: r.source,
      viaLabel: r.viaLabel,
      createdAt: r.createdAt,
    })),
  });
}
