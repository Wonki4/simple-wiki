import { NextRequest } from "next/server";
import { requireApiSpaceRole } from "@/lib/api-auth";
import { listPageTrash } from "@/lib/page-trash";

export async function GET(req: NextRequest, ctx: { params: Promise<{ spaceKey: string }> }) {
  const { spaceKey } = await ctx.params;
  const auth = await requireApiSpaceRole(req, spaceKey, "editor");
  if (!auth.ok) return auth.response;
  return Response.json({ pages: await listPageTrash(auth.space.id) });
}
