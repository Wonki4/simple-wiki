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

  // 멱등적 토글: 삭제(없어도 무해) → 지운 게 없으면 생성(경쟁으로 중복이면 무시).
  // find-then-mutate의 race에서 delete/create가 예외를 던져 에러 페이지로 번지는 것을 막는다.
  const removed = await prisma.like.deleteMany({
    where: { userId: session.userId, pageId: page.id },
  });
  if (removed.count === 0) {
    await prisma.like
      .create({ data: { userId: session.userId, pageId: page.id } })
      .catch(() => {}); // 동시 요청으로 이미 생성됐으면 무시
  }

  revalidatePath(`/s/${spaceKey}/${encodeURIComponent(slug)}`);
  revalidatePath("/me");
}
