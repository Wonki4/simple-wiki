import { prisma } from "@/lib/db";

export interface CommentItem {
  id: string;
  body: string;
  createdAt: Date;
  authorId: string;
  authorName: string;
}

export async function listComments(pageId: string): Promise<CommentItem[]> {
  const comments = await prisma.comment.findMany({
    where: { pageId },
    orderBy: { createdAt: "asc" },
    // 이메일은 조회하지 않는다(열람자에게 PII 노출 방지). 표시 이름만 사용.
    include: { author: { select: { name: true } } },
  });
  return comments.map((c) => ({
    id: c.id,
    body: c.body,
    createdAt: c.createdAt,
    authorId: c.authorId,
    authorName: c.author.name?.trim() || "알 수 없음",
  }));
}

export interface CommentedPage {
  spaceKey: string;
  spaceName: string;
  slug: string;
  title: string;
  commentedAt: Date;
}

// 사용자가 댓글을 단 페이지 목록(중복 제거, 최신 댓글 순). 읽을 수 있는 스페이스로만 필터.
export async function listCommentedPages(
  userId: string,
  readableSpaceIds: string[],
): Promise<CommentedPage[]> {
  if (readableSpaceIds.length === 0) return [];
  const comments = await prisma.comment.findMany({
    where: { authorId: userId, page: { spaceId: { in: readableSpaceIds } } },
    orderBy: { createdAt: "desc" },
    include: {
      page: { select: { slug: true, title: true, space: { select: { key: true, name: true } } } },
    },
  });
  const seen = new Set<string>();
  const out: CommentedPage[] = [];
  for (const c of comments) {
    const key = `${c.page.space.key}/${c.page.slug}`;
    if (seen.has(key)) continue; // 한 글에 댓글 여러 개면 최신 1개만
    seen.add(key);
    out.push({
      spaceKey: c.page.space.key,
      spaceName: c.page.space.name,
      slug: c.page.slug,
      title: c.page.title,
      commentedAt: c.createdAt,
    });
  }
  return out;
}
