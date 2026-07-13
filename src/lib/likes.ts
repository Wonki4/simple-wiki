import { prisma } from "@/lib/db";

export interface LikeState {
  count: number;
  liked: boolean;
}

// 특정 페이지의 좋아요 수와 현재 사용자의 좋아요 여부.
export async function getLikeState(pageId: string, userId: string): Promise<LikeState> {
  const [count, mine] = await Promise.all([
    prisma.like.count({ where: { pageId } }),
    prisma.like.findUnique({ where: { userId_pageId: { userId, pageId } } }),
  ]);
  return { count, liked: Boolean(mine) };
}

export interface LikedPage {
  spaceKey: string;
  spaceName: string;
  slug: string;
  title: string;
  likedAt: Date;
}

// 사용자가 좋아요한 글 목록. 지금도 읽을 수 있는 스페이스로만 필터한다(권한 변동 반영).
export async function listLikedPages(userId: string, readableSpaceIds: string[]): Promise<LikedPage[]> {
  if (readableSpaceIds.length === 0) return [];
  const likes = await prisma.like.findMany({
    where: { userId, page: { spaceId: { in: readableSpaceIds } } },
    orderBy: { createdAt: "desc" },
    include: {
      page: { select: { slug: true, title: true, space: { select: { key: true, name: true } } } },
    },
  });
  return likes.map((l) => ({
    spaceKey: l.page.space.key,
    spaceName: l.page.space.name,
    slug: l.page.slug,
    title: l.page.title,
    likedAt: l.createdAt,
  }));
}
