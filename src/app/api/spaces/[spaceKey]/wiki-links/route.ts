import type { NextRequest } from "next/server";
import { requireApiSpaceRole } from "@/lib/api-auth";
import { prisma } from "@/lib/db";
import { getWikiDestinations } from "@/lib/wiki-link-destinations";
import { wikiSections } from "@/lib/wiki-sections";
import { matchingPages } from "@/lib/wiki-link-completion";
import { slugify } from "@/lib/slug";

export async function GET(request: NextRequest, ctx: { params: Promise<{ spaceKey: string }> }) {
  const { spaceKey } = await ctx.params;
  const auth = await requireApiSpaceRole(request, spaceKey, "viewer");
  if (!auth.ok) return auth.response;
  const target = request.nextUrl.searchParams.get("document");
  let results;
  if (target) {
    const names = await getWikiDestinations(auth.space.id);
    const slug = names.get(slugify(target));
    const page = slug && await prisma.page.findUnique({
      where: { spaceId_slug: { spaceId: auth.space.id, slug }, deletedAt: null }, select: { content: true },
    });
    results = page ? wikiSections(page.content).map(section => ({ title: section.title, slug: section.id.slice("section-".length) })) : [];
  } else {
    const pages = await prisma.page.findMany({
      where: { spaceId: auth.space.id, deletedAt: null }, select: { title: true, slug: true }, orderBy: { title: "asc" },
    });
    results = matchingPages(pages, request.nextUrl.searchParams.get("q") ?? "");
  }
  return Response.json(results, { headers: { "Cache-Control": "private, no-store" } });
}
