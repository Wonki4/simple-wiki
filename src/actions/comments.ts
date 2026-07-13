"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requireSpaceRole } from "@/lib/access";
import { hasRole } from "@/lib/permissions";

// 댓글 작성. 읽을 수 있는 스페이스면 누구나(viewer).
export async function addComment(spaceKey: string, slug: string, formData: FormData) {
  const { session, space } = await requireSpaceRole(spaceKey, "viewer");
  const body = String(formData.get("body") ?? "").trim();
  if (!body) return;

  const page = await prisma.page.findUnique({
    where: { spaceId_slug: { spaceId: space.id, slug } },
    select: { id: true },
  });
  if (!page) return;

  await prisma.comment.create({
    data: { pageId: page.id, authorId: session.userId, body: body.slice(0, 5000) },
  });
  revalidatePath(`/s/${spaceKey}/${encodeURIComponent(slug)}`);
}

// 댓글 삭제. 본인 또는 스페이스 admin(모더레이션).
export async function deleteComment(spaceKey: string, slug: string, commentId: string) {
  const { session, space, role } = await requireSpaceRole(spaceKey, "viewer");
  const comment = await prisma.comment.findUnique({
    where: { id: commentId },
    select: { authorId: true, page: { select: { spaceId: true } } },
  });
  if (!comment || comment.page.spaceId !== space.id) return;

  const isAuthor = comment.authorId === session.userId;
  if (!isAuthor && !hasRole(role, "admin")) return; // 권한 없으면 조용히 무시

  await prisma.comment.delete({ where: { id: commentId } });
  revalidatePath(`/s/${spaceKey}/${encodeURIComponent(slug)}`);
}
