"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requireSpaceRole } from "@/lib/access";
import { createPageInSpace, updatePageInSpace, revertPage } from "@/lib/pages";
import { PageConflictError } from "@/lib/page-edits";

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

export type SaveResult = { conflict: true; currentVersion: number } | void;

export async function updatePage(
  spaceKey: string,
  slug: string,
  formData: FormData,
): Promise<SaveResult> {
  const title = String(formData.get("title") ?? "").trim();
  const content = String(formData.get("content") ?? "");
  const ev = formData.get("expectedVersion");
  const expectedVersion = typeof ev === "string" && ev !== "" ? Number(ev) : undefined;

  const { session, space } = await requireSpaceRole(spaceKey, "editor");
  try {
    const found = await updatePageInSpace({
      spaceId: space.id,
      slug,
      title,
      content,
      authorId: session.userId,
      expectedVersion,
    });
    if (!found) throw new Error("페이지가 없습니다.");
  } catch (e) {
    if (e instanceof PageConflictError) {
      return { conflict: true, currentVersion: e.currentVersion };
    }
    throw e;
  }

  revalidatePath(`/s/${spaceKey}`);
  revalidatePath(`/s/${spaceKey}/${encodeURIComponent(slug)}`);
  redirect(`/s/${spaceKey}/${encodeURIComponent(slug)}`);
}

export async function deletePage(spaceKey: string, slug: string) {
  const { space } = await requireSpaceRole(spaceKey, "editor");
  await prisma.page.deleteMany({ where: { spaceId: space.id, slug } });
  revalidatePath(`/s/${spaceKey}`);
  redirect(`/s/${spaceKey}`);
}

export async function restoreRevision(spaceKey: string, slug: string, version: number) {
  const { session, space } = await requireSpaceRole(spaceKey, "editor");
  const result = await revertPage({
    spaceId: space.id,
    slug,
    version,
    authorId: session.userId,
  });
  if (!result.found) throw new Error("페이지가 없습니다.");
  if (result.missingRevision) throw new Error("해당 버전이 없습니다.");

  revalidatePath(`/s/${spaceKey}`);
  revalidatePath(`/s/${spaceKey}/${encodeURIComponent(slug)}`);
  redirect(`/s/${spaceKey}/${encodeURIComponent(slug)}`);
}
