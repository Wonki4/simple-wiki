"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requireSpaceRole } from "@/lib/access";
import { createPageInSpace, updatePageInSpace, revertPage, movePageInSpace } from "@/lib/pages";
import { PageConflictError } from "@/lib/page-edits";
import { invalidatePageCache } from "@/lib/page-render-cache";

export async function createPage(spaceKey: string, parentSlug: string | null, formData: FormData) {
  const { session, space } = await requireSpaceRole(spaceKey, "editor");
  const title = String(formData.get("title") ?? "").trim();
  const content = String(formData.get("content") ?? "");

  let parentId: string | null = null;
  if (parentSlug) {
    const parent = await prisma.page.findUnique({
      where: { spaceId_slug: { spaceId: space.id, slug: parentSlug } },
      select: { id: true },
    });
    // 부모가 그사이 삭제된 경우 — 조용히 최상위로 만들지 않고 명시적으로 알린다.
    if (!parent) {
      redirect(`/s/${spaceKey}/new?error=${encodeURIComponent("부모 문서가 없습니다. 삭제되었을 수 있습니다.")}`);
    }
    parentId = parent.id;
  }

  const { slug, created } = await createPageInSpace({
    spaceId: space.id,
    title,
    content,
    authorId: session.userId,
    parentId,
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
    const result = await updatePageInSpace({
      spaceId: space.id,
      slug,
      title,
      content,
      authorId: session.userId,
      expectedVersion,
    });
    if (!result.found) throw new Error("페이지가 없습니다.");
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

export async function movePage(spaceKey: string, slug: string, formData: FormData) {
  const { space } = await requireSpaceRole(spaceKey, "editor");
  const raw = String(formData.get("parent") ?? "");
  const result = await movePageInSpace({
    spaceId: space.id,
    slug,
    parentSlug: raw === "" ? null : raw,
  });
  if (!result.ok) {
    const msg =
      result.reason === "cycle"
        ? "자기 자신이나 하위 문서로는 이동할 수 없습니다."
        : result.reason === "parent-not-found"
          ? "대상 문서가 없습니다. 삭제되었을 수 있습니다."
          : "문서가 없습니다.";
    console.warn(`[tree] 이동 실패 — ${result.reason} (space=${spaceKey}, slug=${JSON.stringify(slug)})`);
    redirect(`/s/${spaceKey}/${encodeURIComponent(slug)}?error=${encodeURIComponent(msg)}`);
  }
  revalidatePath(`/s/${spaceKey}`);
  revalidatePath(`/s/${spaceKey}/${encodeURIComponent(slug)}`);
  redirect(`/s/${spaceKey}/${encodeURIComponent(slug)}`);
}

export async function deletePage(spaceKey: string, slug: string) {
  const { space } = await requireSpaceRole(spaceKey, "editor");
  const page = await prisma.page.findUnique({
    where: { spaceId_slug: { spaceId: space.id, slug } },
    select: { id: true, parentId: true },
  });
  if (page) {
    // 자식은 삭제 문서의 부모로 승격 — 하위 내용이 함께 사라지지 않는다.
    await prisma.$transaction([
      prisma.page.updateMany({ where: { parentId: page.id }, data: { parentId: page.parentId } }),
      prisma.page.delete({ where: { id: page.id } }),
    ]);
    invalidatePageCache(page.id);
  }
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
