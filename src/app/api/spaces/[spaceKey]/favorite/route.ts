import { Prisma } from "@prisma/client";
import type { NextRequest } from "next/server";
import { requireApiSpaceRole } from "@/lib/api-auth";
import { prisma } from "@/lib/db";

type Context = { params: Promise<{ spaceKey: string }> };

async function setFavorite(request: NextRequest, ctx: Context, favorite: boolean) {
  const { spaceKey } = await ctx.params;
  const auth = await requireApiSpaceRole(request, spaceKey, "viewer", { actorPermissionsOnly: true });
  if (!auth.ok) return auth.response;
  if (auth.actor.tokenScope?.readOnly) {
    return Response.json({ error: "읽기 전용 토큰으로는 즐겨찾기를 변경할 수 없습니다." }, { status: 403 });
  }
  const pair = { userId: auth.actor.userId, spaceId: auth.space.id };
  if (favorite) {
    try {
      await prisma.spaceFavorite.createMany({ data: [pair], skipDuplicates: true });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2003") {
        return Response.json({ error: "즐겨찾기를 저장할 수 없습니다." }, { status: 404 });
      }
      throw error;
    }
  } else {
    await prisma.spaceFavorite.deleteMany({ where: pair });
  }
  return Response.json({ favorite });
}

export function PUT(request: NextRequest, ctx: Context) {
  return setFavorite(request, ctx, true);
}

export function DELETE(request: NextRequest, ctx: Context) {
  return setFavorite(request, ctx, false);
}
