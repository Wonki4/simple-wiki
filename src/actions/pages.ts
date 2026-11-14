"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { getSessionInfo, requireSpaceRole } from "@/lib/access";
import { createPageInSpace, updatePageInSpace, revertPage, movePageInSpace } from "@/lib/pages";
import type { PageDraft } from "@/lib/editor-draft";
import { deletePageInSpace, restoreTrashedPage } from "@/lib/page-trash";
import { PageConflictError } from "@/lib/page-edits";

export type SaveResult =
  | { savedHref: string }
  | { conflict: true; currentVersion: number }
  | { authRequired: true }
  | { error: string };

export async function createPage(spaceKey: string, parentSlug: string | null, draft: PageDraft): Promise<SaveResult> {
  // 에디터가 작성 중인 내용을 보관하고 재로그인할 수 있게 일반 이동 대신 신호를 돌려준다.
  if (!(await getSessionInfo())) return { authRequired: true };
  const { session, space } = await requireSpaceRole(spaceKey, "editor");
  const { title, content } = draft;

  let parentId: string | null = null;
  if (parentSlug) {
    const parent = await prisma.page.findUnique({
      where: { deletedAt: null, spaceId_slug: { spaceId: space.id, slug: parentSlug } },
      select: { id: true },
    });
    // 부모가 그사이 삭제된 경우 — 조용히 최상위로 만들지 않고 명시적으로 알린다.
    if (!parent) {
      return { error: "부모 문서가 없습니다. 작성 내용을 복사한 뒤 다른 위치에 저장하세요." };
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
  if (!created) return { error: "같은 주소의 문서가 이미 있습니다. 제목을 바꿔 다시 저장하세요." };

  revalidatePath(`/s/${spaceKey}`);
  return { savedHref: `/s/${spaceKey}/${encodeURIComponent(slug)}` };
}

export async function updatePage(
  spaceKey: string,
  slug: string,
  draft: PageDraft,
): Promise<SaveResult> {
  const { title, content, expectedVersion } = draft;

  if (!(await getSessionInfo())) return { authRequired: true };
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
  return { savedHref: `/s/${spaceKey}/${encodeURIComponent(slug)}` };
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
  const { space, session } = await requireSpaceRole(spaceKey, "editor");
  await deletePageInSpace(space.id, slug, session.userId);
  revalidatePath(`/s/${spaceKey}`, "layout");
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

export async function restoreFromTrash(spaceKey: string, id: string, form: FormData) {
  const { space } = await requireSpaceRole(spaceKey, "editor");
  const result = await restoreTrashedPage(space.id, id, String(form.get("slug") ?? ""));
  if (result.status === "restored") {
    revalidatePath(`/s/${spaceKey}`, "layout");
    redirect(`/s/${spaceKey}/${encodeURIComponent(result.slug)}`);
  }
  redirect(`/s/${spaceKey}/-/trash?item=${encodeURIComponent(id)}&error=${result.status}`);
}
