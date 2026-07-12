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
