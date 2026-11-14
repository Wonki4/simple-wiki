import { prisma } from "./db";
import { visibleTreePages } from "./page-tree";

export async function getSpaceTree(spaceId: string) {
  const pages = await prisma.page.findMany({
    where: { spaceId },
    orderBy: { title: "asc" },
    select: { id: true, parentId: true, deletedAt: true, slug: true, title: true, updatedAt: true },
  });
  return visibleTreePages(pages);
}
