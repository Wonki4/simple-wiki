import { Prisma } from "@prisma/client";
import { revalidateTag } from "next/cache";
import { prisma } from "./db";
import { invalidateWikiNames } from "./wiki-link-destinations";
import { invalidatePageCache } from "./page-render-cache";
import { slugify } from "./slug";

function refreshVisibility(spaceId: string, id: string) {
  invalidateWikiNames(spaceId);
  invalidatePageCache(id);
  revalidateTag("page-search");
}

export async function deletePageInSpace(spaceId: string, slug: string, userId: string) {
  // 사용자 slug에는 ':'가 올 수 없다. 원래 URL을 재사용해도 복원은 불변 id로 지정한다.
  const [page] = await prisma.$queryRaw<{ id: string }[]>`
    UPDATE "Page" SET "deletedSlug" = slug, slug = 'trash:' || id,
      "deletedAt" = CURRENT_TIMESTAMP, "deletedById" = ${userId}
    WHERE "spaceId" = ${spaceId} AND slug = ${slug} AND "deletedAt" IS NULL
    RETURNING id
  `;
  if (page) refreshVisibility(spaceId, page.id);
  return page?.id;
}

export async function listPageTrash(spaceId: string) {
  const pages = await prisma.page.findMany({
    where: { spaceId, deletedAt: { not: null } },
    orderBy: [{ deletedAt: "desc" }, { id: "asc" }],
    select: {
      id: true, title: true, deletedSlug: true, deletedAt: true, deletedById: true,
      parent: { select: { title: true } },
    },
  });
  const users = await prisma.user.findMany({
    where: { id: { in: [...new Set(pages.flatMap(p => p.deletedById ? [p.deletedById] : []))] } },
    select: { id: true, name: true },
  });
  const names = new Map(users.map(user => [user.id, user.name]));
  return pages.map(page => ({
    id: page.id, title: page.title, slug: page.deletedSlug!, deletedAt: page.deletedAt!,
    deletedBy: names.get(page.deletedById!) || "알 수 없음", parentTitle: page.parent?.title ?? null,
  }));
}

export async function restoreTrashedPage(spaceId: string, id: string, requestedSlug?: string) {
  const alternate = requestedSlug?.trim();
  const newSlug = alternate ? slugify(alternate) : undefined;
  // 정적 라우트(new, settings)는 문서 주소로 열 수 없다.
  if (alternate && (!newSlug || newSlug === "new" || newSlug === "settings")) {
    return { status: "invalid" } as const;
  }
  try {
    const restored = await prisma.$queryRaw<{ slug: string }[]>`
      UPDATE "Page" SET slug = COALESCE(${newSlug ?? null}::text, "deletedSlug"),
        "deletedSlug" = NULL, "deletedAt" = NULL, "deletedById" = NULL
      WHERE "spaceId" = ${spaceId} AND id = ${id} AND "deletedAt" IS NOT NULL
      RETURNING slug
    `;
    if (!restored.length) return { status: "missing" } as const;
    refreshVisibility(spaceId, id);
    return { status: "restored", slug: restored[0].slug } as const;
  } catch (err) {
    // PostgreSQL의 유일 제약은 동시 생성/복원도 처리한다. 실패한 UPDATE는 원자적으로 롤백된다.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2010" && err.meta?.code === "23505") {
      return { status: "taken" } as const;
    }
    throw err;
  }
}
