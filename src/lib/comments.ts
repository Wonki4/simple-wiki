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
    include: { author: { select: { name: true, email: true } } },
  });
  return comments.map((c) => ({
    id: c.id,
    body: c.body,
    createdAt: c.createdAt,
    authorId: c.authorId,
    authorName: c.author.name || c.author.email || c.authorId,
  }));
}
