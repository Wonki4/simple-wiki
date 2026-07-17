import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { slugify } from "@/lib/slug";
import { extractWikiLinks } from "@/lib/wiki-links";
import { invalidatePageCache } from "@/lib/page-render-cache";
import { selfAndDescendantIds } from "@/lib/page-tree";
import {
  appendContent,
  applyReplace,
  assertExpectedVersion,
  isVersionConflict,
  PageConflictError,
} from "@/lib/page-edits";

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

// 페이지 본문 교체를 한 트랜잭션으로 커밋한다: Page 갱신 + 새 리비전 + 링크 동기화.
// 경합(같은 다음 version을 동시에 쓰는 경우)은 (pageId, version) 유니크 위반으로 감지해
// PageConflictError로 번역한다. 반환값은 새로 만들어진 버전 번호.
async function commitRevision(input: {
  page: { id: string; version: number; spaceId: string };
  title: string;
  content: string;
  authorId: string;
  source: EditSource;
  viaLabel: string | null;
}): Promise<number> {
  const nextV = input.page.version + 1;
  try {
    await prisma.$transaction(async (tx) => {
      await tx.page.update({
        where: { id: input.page.id },
        data: {
          title: input.title,
          content: input.content,
          version: nextV,
          updatedById: input.authorId,
          updatedSource: input.source,
          updatedViaLabel: input.viaLabel,
        },
      });
      await tx.pageRevision.create({
        data: {
          pageId: input.page.id,
          version: nextV,
          title: input.title,
          content: input.content,
          authorId: input.authorId,
          source: input.source,
          viaLabel: input.viaLabel,
        },
      });
      await syncLinks(tx, input.page.id, input.page.spaceId, input.content);
    });
  } catch (e) {
    if (isVersionConflict(e)) {
      // Page.version이 PageRevision.version보다 뒤처져 있을 수 있다(과거 이상 상태 등).
      // 그대로 두면 fresh?.version이 매번 실제보다 낮게 나와 이후 모든 쓰기가 영구히 409가 된다.
      // 두 값의 max로 진짜 현재 버전을 구하고, Page.version이 뒤처졌으면 맞춰 자가치유한다.
      const [fresh, maxRev] = await Promise.all([
        prisma.page.findUnique({
          where: { id: input.page.id },
          select: { version: true },
        }),
        prisma.pageRevision.aggregate({
          where: { pageId: input.page.id },
          _max: { version: true },
        }),
      ]);
      const freshVersion = fresh?.version ?? 0;
      const maxRevVersion = maxRev._max.version ?? 0;
      const currentVersion = Math.max(freshVersion, maxRevVersion);
      if (currentVersion > 0 && freshVersion < currentVersion) {
        await prisma.page
          .update({ where: { id: input.page.id }, data: { version: currentVersion } })
          .catch(() => {});
      }
      throw new PageConflictError(currentVersion || nextV);
    }
    throw e;
  }
  invalidatePageCache(input.page.id);
  return nextV;
}

export type EditSource = "web" | "api";

export interface WritePageInput {
  spaceId: string;
  title: string;
  content: string;
  authorId: string;
  // 편집 출처. 생략 시 "web"(사람). API 토큰 경로는 "api" + 토큰 이름을 넘긴다.
  source?: EditSource;
  viaLabel?: string | null;
  // 페이지 트리: 부모 페이지 id(null/생략 = 최상위). 같은 스페이스인지는 호출자가 검증한다.
  parentId?: string | null;
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

  const source = input.source ?? "web";
  const viaLabel = input.viaLabel ?? null;

  await prisma.$transaction(async (tx) => {
    const page = await tx.page.create({
      data: {
        spaceId: input.spaceId,
        slug,
        title,
        content: input.content,
        createdById: input.authorId,
        updatedById: input.authorId,
        updatedSource: source,
        updatedViaLabel: viaLabel,
        parentId: input.parentId ?? null,
      },
    });
    await tx.pageRevision.create({
      data: { pageId: page.id, version: 1, title, content: input.content, authorId: input.authorId, source, viaLabel },
    });
    await syncLinks(tx, page.id, input.spaceId, input.content);
  });

  return { slug, created: true };
}

/**
 * 기존 페이지 수정. 제목이 바뀌어도 slug는 유지한다(링크 안정성).
 * 저장할 때마다 새 리비전 스냅샷을 남긴다. 페이지가 없으면 { found: false }.
 * expectedVersion이 주어지면 현재 버전과 다를 때 PageConflictError를 던진다.
 */
export async function updatePageInSpace(
  input: WritePageInput & { slug: string; expectedVersion?: number },
): Promise<{ found: boolean; version?: number }> {
  const title = input.title.trim();
  if (!title) throw new Error("제목을 입력하세요.");

  const page = await prisma.page.findUnique({
    where: { spaceId_slug: { spaceId: input.spaceId, slug: input.slug } },
  });
  if (!page) return { found: false };

  assertExpectedVersion(page.version, input.expectedVersion);

  const version = await commitRevision({
    page: { id: page.id, version: page.version, spaceId: input.spaceId },
    title,
    content: input.content,
    authorId: input.authorId,
    source: input.source ?? "web",
    viaLabel: input.viaLabel ?? null,
  });

  return { found: true, version };
}

export type EditActionInput = {
  spaceId: string;
  slug: string;
  authorId: string;
  source?: EditSource;
  viaLabel?: string | null;
  expectedVersion?: number;
};

/**
 * 현재 본문을 읽어 transform을 적용한 뒤 커밋한다(부분 편집의 공통 경로).
 * 제목은 유지한다. transform은 위반 시 throw할 수 있다(예: ReplaceError).
 * 페이지가 없으면 { found: false }.
 */
export async function editPageContent(
  input: EditActionInput,
  transform: (current: string) => string,
): Promise<{ found: boolean; version?: number }> {
  const page = await prisma.page.findUnique({
    where: { spaceId_slug: { spaceId: input.spaceId, slug: input.slug } },
  });
  if (!page) return { found: false };

  assertExpectedVersion(page.version, input.expectedVersion);
  const newContent = transform(page.content); // 위반 시 여기서 throw

  const version = await commitRevision({
    page: { id: page.id, version: page.version, spaceId: input.spaceId },
    title: page.title,
    content: newContent,
    authorId: input.authorId,
    source: input.source ?? "web",
    viaLabel: input.viaLabel ?? null,
  });
  return { found: true, version };
}

// 본문 끝에 content를 덧붙인다.
export function appendToPage(
  input: EditActionInput & { content: string },
): Promise<{ found: boolean; version?: number }> {
  return editPageContent(input, (current) => appendContent(current, input.content));
}

// oldString을 정확히 1곳에서 newString으로 치환한다(0곳/2곳↑는 ReplaceError).
export function replaceInPage(
  input: EditActionInput & { oldString: string; newString: string },
): Promise<{ found: boolean; version?: number }> {
  return editPageContent(input, (current) => applyReplace(current, input.oldString, input.newString));
}

/**
 * 과거 리비전 vN의 title+content를 새 리비전으로 전진 복원한다(이력 삭제 없음).
 * 페이지 없음 → { found: false }. 해당 버전 없음 → { found: true, missingRevision: true }.
 * expectedVersion이 주어지면 현재 버전과 다를 때 PageConflictError.
 */
export async function revertPage(input: {
  spaceId: string;
  slug: string;
  version: number;
  authorId: string;
  source?: EditSource;
  viaLabel?: string | null;
  expectedVersion?: number;
}): Promise<{ found: boolean; missingRevision?: boolean; version?: number }> {
  const page = await prisma.page.findUnique({
    where: { spaceId_slug: { spaceId: input.spaceId, slug: input.slug } },
  });
  if (!page) return { found: false };

  assertExpectedVersion(page.version, input.expectedVersion);

  const rev = await prisma.pageRevision.findUnique({
    where: { pageId_version: { pageId: page.id, version: input.version } },
  });
  if (!rev) return { found: true, missingRevision: true };

  const version = await commitRevision({
    page: { id: page.id, version: page.version, spaceId: input.spaceId },
    title: rev.title,
    content: rev.content,
    authorId: input.authorId,
    source: input.source ?? "web",
    viaLabel: input.viaLabel ?? null,
  });
  return { found: true, version };
}

export type MovePageResult =
  | { ok: true }
  | { ok: false; reason: "not-found" | "parent-not-found" | "cycle" };

/**
 * 페이지를 트리에서 이동한다(parentSlug=null이면 최상위). 본문 불변 — 리비전을 만들지 않는다.
 * 자기 자신·자손으로의 이동(순환)과 타 스페이스 부모는 거부한다.
 */
export async function movePageInSpace(input: {
  spaceId: string;
  slug: string;
  parentSlug: string | null;
}): Promise<MovePageResult> {
  const pages = await prisma.page.findMany({
    where: { spaceId: input.spaceId },
    select: { id: true, slug: true, parentId: true },
  });
  const page = pages.find((p) => p.slug === input.slug);
  if (!page) return { ok: false, reason: "not-found" };

  let parentId: string | null = null;
  if (input.parentSlug !== null) {
    const parent = pages.find((p) => p.slug === input.parentSlug);
    if (!parent) return { ok: false, reason: "parent-not-found" };
    if (selfAndDescendantIds(pages, page.id).has(parent.id)) return { ok: false, reason: "cycle" };
    parentId = parent.id;
  }
  await prisma.page.update({ where: { id: page.id }, data: { parentId } });
  return { ok: true };
}
