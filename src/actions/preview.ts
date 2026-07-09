"use server";

import { requireSpaceRole } from "@/lib/access";
import { renderMarkdown } from "@/lib/markdown";
import { extractWikiLinks } from "@/lib/wiki-links";
import { prisma } from "@/lib/db";

export async function previewMarkdown(spaceKey: string, content: string): Promise<string> {
  const { space } = await requireSpaceRole(spaceKey, "viewer");
  const targets = extractWikiLinks(content).map((l) => l.slug);
  const existing = targets.length
    ? await prisma.page.findMany({
        where: { spaceId: space.id, slug: { in: targets } },
        select: { slug: true },
      })
    : [];
  return renderMarkdown(content, { spaceKey, existingSlugs: new Set(existing.map((p) => p.slug)) });
}
