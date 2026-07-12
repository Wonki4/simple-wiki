"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requireSpaceRole } from "@/lib/access";

// 좋아요 토글. 읽을 수 있는 스페이스의 글만 가능(viewer 권한).
export async function toggleLike(spaceKey: string, slug: string) {
  const { session, space } = await requireSpaceRole(spaceKey, "viewer");
  const page = await prisma.page.findUnique({
    where: { spaceId_slug: { spaceId: space.id, slug } },
    select: { id: true },
  });
  if (!page) return;

  const existing = await prisma.like.findUnique({
    where: { userId_pageId: { userId: session.userId, pageId: page.id } },
  });
  if (existing) {
    await prisma.like.delete({ where: { id: existing.id } });
  } else {
    await prisma.like.create({ data: { userId: session.userId, pageId: page.id } });
  }

  revalidatePath(`/s/${spaceKey}/${encodeURIComponent(slug)}`);
  revalidatePath("/me");
}
