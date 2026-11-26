import type { NextRequest } from "next/server";
import { requireApiSpaceRole } from "@/lib/api-auth";
import { JsonInputError } from "@/lib/bounded-json";
import { listWikiTopics } from "@/lib/llm-wiki";
import { wikiListOptions } from "@/lib/llm-wiki-input";

export async function GET(request: NextRequest, ctx: { params: Promise<{ spaceKey: string }> }) {
  const { spaceKey } = await ctx.params;
  const auth = await requireApiSpaceRole(request, spaceKey, "viewer", { actorPermissionsOnly: true });
  if (!auth.ok) return auth.response;
  try {
    const options = wikiListOptions(request.nextUrl.searchParams);
    return Response.json(await listWikiTopics(auth.space.id, options));
  } catch (error) {
    if (error instanceof JsonInputError) return Response.json({ error: error.message }, { status: error.status });
    throw error;
  }
}
