import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { slugify } from "@/lib/slug";
import { extractWikiLinks } from "@/lib/wiki-links";

// 페이지 본문의 [[위키링크]]를 파싱해 PageLink를 재생성한다(백링크/red link 판별용).
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

export interface WritePageInput {
  spaceId: string;
  title: string;
  content: string;
  authorId: string;
}

/**
 * 새 페이지 생성. slug는 제목에서 파생한다.
 * 같은 slug가 이미 있으면 생성하지 않고 { created: false }를 반환한다(호출자가 처리).
 * Page + 초기 PageRevision + PageLink를 한 트랜잭션으로 만든다.
 */
export async function createPageInSpace(
  input: WritePageInput,
): Promise<{ slug: string; created: boolean }> {
  const title = input.title.trim();
  if (!title) throw new Error("제목을 입력하세요.");
  const slug = slugify(title);
  if (!slug) throw new Error("제목에 사용할 수 있는 문자가 없습니다.");

  const existing = await prisma.page.findUnique({
    where: { spaceId_slug: { spaceId: input.spaceId, slug } },
  });
  if (existing) return { slug, created: false };

  await prisma.$transaction(async (tx) => {
    const page = await tx.page.create({
      data: {
        spaceId: input.spaceId,
        slug,
        title,
        content: input.content,
        createdById: input.authorId,
        updatedById: input.authorId,
      },
    });
    await tx.pageRevision.create({
      data: { pageId: page.id, version: 1, title, content: input.content, authorId: input.authorId },
    });
    await syncLinks(tx, page.id, input.spaceId, input.content);
  });

  return { slug, created: true };
}

/**
 * 기존 페이지 수정. 제목이 바뀌어도 slug는 유지한다(링크 안정성).
 * 저장할 때마다 새 리비전 스냅샷을 남긴다. 페이지가 없으면 false.
 */
export async function updatePageInSpace(
  input: WritePageInput & { slug: string },
): Promise<boolean> {
  const title = input.title.trim();
  if (!title) throw new Error("제목을 입력하세요.");

  const page = await prisma.page.findUnique({
    where: { spaceId_slug: { spaceId: input.spaceId, slug: input.slug } },
  });
  if (!page) return false;

  await prisma.$transaction(async (tx) => {
    await tx.page.update({
      where: { id: page.id },
      data: { title, content: input.content, updatedById: input.authorId },
    });
    await tx.pageRevision.create({
      data: {
        pageId: page.id,
        version: await nextVersion(tx, page.id),
        title,
        content: input.content,
        authorId: input.authorId,
      },
    });
    await syncLinks(tx, page.id, input.spaceId, input.content);
  });

  return true;
}
