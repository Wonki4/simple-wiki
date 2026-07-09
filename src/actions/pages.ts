"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { requireSpaceRole } from "@/lib/access";
import { slugify } from "@/lib/slug";
import { extractWikiLinks } from "@/lib/wiki-links";

async function syncLinks(tx: Prisma.TransactionClient, pageId: string, spaceId: string, content: string) {
  await tx.pageLink.deleteMany({ where: { fromPageId: pageId } });
  const links = extractWikiLinks(content);
  if (links.length > 0) {
    await tx.pageLink.createMany({
      data: links.map((l) => ({ fromPageId: pageId, toSpaceId: spaceId, toSlug: l.slug })),
    });
  }
}

async function nextVersion(tx: Prisma.TransactionClient, pageId: string): Promise<number> {
  const last = await tx.pageRevision.aggregate({ where: { pageId }, _max: { version: true } });
  return (last._max.version ?? 0) + 1;
}

export async function createPage(spaceKey: string, formData: FormData) {
  const { session, space } = await requireSpaceRole(spaceKey, "editor");
  const title = String(formData.get("title") ?? "").trim();
  const content = String(formData.get("content") ?? "");
  if (!title) throw new Error("제목을 입력하세요.");
  const slug = slugify(title);
  if (!slug) throw new Error("제목에 사용할 수 있는 문자가 없습니다.");

  const existing = await prisma.page.findUnique({
    where: { spaceId_slug: { spaceId: space.id, slug } },
  });
  if (existing) redirect(`/s/${spaceKey}/${encodeURIComponent(slug)}/edit`);

  await prisma.$transaction(async (tx) => {
    const page = await tx.page.create({
      data: { spaceId: space.id, slug, title, content, createdById: session.userId, updatedById: session.userId },
    });
    await tx.pageRevision.create({
      data: { pageId: page.id, version: 1, title, content, authorId: session.userId },
    });
    await syncLinks(tx, page.id, space.id, content);
  });

  revalidatePath(`/s/${spaceKey}`);
  redirect(`/s/${spaceKey}/${encodeURIComponent(slug)}`);
}

async function saveRevision(
  spaceKey: string,
  slug: string,
  title: string,
  content: string,
): Promise<void> {
  const { session, space } = await requireSpaceRole(spaceKey, "editor");
  const page = await prisma.page.findUnique({
    where: { spaceId_slug: { spaceId: space.id, slug } },
  });
  if (!page) throw new Error("페이지가 없습니다.");

  await prisma.$transaction(async (tx) => {
    await tx.page.update({
      where: { id: page.id },
      data: { title, content, updatedById: session.userId },
    });
    await tx.pageRevision.create({
      data: { pageId: page.id, version: await nextVersion(tx, page.id), title, content, authorId: session.userId },
    });
    await syncLinks(tx, page.id, space.id, content);
  });

  revalidatePath(`/s/${spaceKey}`);
  revalidatePath(`/s/${spaceKey}/${encodeURIComponent(slug)}`);
}

export async function updatePage(spaceKey: string, slug: string, formData: FormData) {
  const title = String(formData.get("title") ?? "").trim();
  const content = String(formData.get("content") ?? "");
  if (!title) throw new Error("제목을 입력하세요.");
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
