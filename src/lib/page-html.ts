import { prisma } from "@/lib/db";
import { assertExpectedVersion } from "@/lib/page-edits";

export async function savePageHtml(input: {
  spaceId: string;
  slug: string;
  html: string;
  baseVersion: number;
}): Promise<boolean> {
  const { spaceId, slug, html, baseVersion } = input;
  return prisma.$transaction(async tx => {
    // Keep Markdown edits, trash operations and competing preview saves ordered on this page.
    const [page] = await tx.$queryRaw<Array<{ id: string; version: number }>>`
      SELECT id, version FROM "Page"
      WHERE "spaceId" = ${spaceId} AND slug = ${slug} AND "deletedAt" IS NULL
      FOR UPDATE
    `;
    if (!page) return false;
    assertExpectedVersion(page.version, baseVersion);
    await tx.pageHtml.upsert({
      where: { pageId: page.id },
      create: { pageId: page.id, html, baseVersion },
      update: { html, baseVersion },
      select: { pageId: true },
    });
    return true;
  });
}
