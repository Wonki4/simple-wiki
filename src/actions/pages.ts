"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requireSpaceRole } from "@/lib/access";
import { createPageInSpace, updatePageInSpace } from "@/lib/pages";

export async function createPage(spaceKey: string, formData: FormData) {
  const { session, space } = await requireSpaceRole(spaceKey, "editor");
  const title = String(formData.get("title") ?? "").trim();
  const content = String(formData.get("content") ?? "");

  const { slug, created } = await createPageInSpace({
    spaceId: space.id,
    title,
    content,
    authorId: session.userId,
  });
  // 같은 slug가 이미 있으면 그 페이지의 편집 화면으로 보낸다.
  if (!created) redirect(`/s/${spaceKey}/${encodeURIComponent(slug)}/edit`);

  revalidatePath(`/s/${spaceKey}`);
  redirect(`/s/${spaceKey}/${encodeURIComponent(slug)}`);
}

async function saveRevision(spaceKey: string, slug: string, title: string, content: string): Promise<void> {
  const { session, space } = await requireSpaceRole(spaceKey, "editor");
  const found = await updatePageInSpace({
    spaceId: space.id,
    slug,
    title,
    content,
    authorId: session.userId,
  });
  if (!found) throw new Error("페이지가 없습니다.");

  revalidatePath(`/s/${spaceKey}`);
  revalidatePath(`/s/${spaceKey}/${encodeURIComponent(slug)}`);
}

export async function updatePage(spaceKey: string, slug: string, formData: FormData) {
  const title = String(formData.get("title") ?? "").trim();
  const content = String(formData.get("content") ?? "");
  await saveRevision(spaceKey, slug, title, content);
  redirect(`/s/${spaceKey}/${encodeURIComponent(slug)}`);
}

export async function deletePage(spaceKey: string, slug: string) {
  const { space } = await requireSpaceRole(spaceKey, "editor");
  await prisma.page.deleteMany({ where: { spaceId: space.id, slug } });
  revalidatePath(`/s/${spaceKey}`);
  redirect(`/s/${spaceKey}`);
}

export async function restoreRevision(spaceKey: string, slug: string, version: number) {
  const { space } = await requireSpaceRole(spaceKey, "editor");
  const page = await prisma.page.findUnique({
    where: { spaceId_slug: { spaceId: space.id, slug } },
  });
  if (!page) throw new Error("페이지가 없습니다.");
  const rev = await prisma.pageRevision.findUnique({
    where: { pageId_version: { pageId: page.id, version } },
  });
  if (!rev) throw new Error("해당 버전이 없습니다.");
  await saveRevision(spaceKey, slug, rev.title, rev.content);
  redirect(`/s/${spaceKey}/${encodeURIComponent(slug)}`);
}
