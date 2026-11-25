import type { NextRequest } from "next/server";
import { requireApiSpaceRole } from "@/lib/api-auth";
import { JsonInputError } from "@/lib/bounded-json";
import { listTimelineSources } from "@/lib/timeline-write";

export async function GET(request: NextRequest, ctx: { params: Promise<{ spaceKey: string }> }) {
  const { spaceKey } = await ctx.params;
  const auth = await requireApiSpaceRole(request, spaceKey, "viewer", { actorPermissionsOnly: true });
  if (!auth.ok) return auth.response;
  try {
    return Response.json(await listTimelineSources(auth.space.id, request.nextUrl.searchParams));
  } catch (error) {
    if (error instanceof JsonInputError) return Response.json({ error: error.message }, { status: error.status });
    throw error;
  }
}
