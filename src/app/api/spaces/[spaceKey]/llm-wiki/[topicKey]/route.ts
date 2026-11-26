import type { NextRequest } from "next/server";
import { requireApiSpaceRole } from "@/lib/api-auth";
import { getWikiTopic } from "@/lib/llm-wiki";

export async function GET(request: NextRequest, ctx: { params: Promise<{ spaceKey: string; topicKey: string }> }) {
  const { spaceKey, topicKey } = await ctx.params;
  const auth = await requireApiSpaceRole(request, spaceKey, "viewer", { actorPermissionsOnly: true });
  if (!auth.ok) return auth.response;
  let key: string;
  try { key = decodeURIComponent(topicKey); }
  catch { return Response.json({ error: "주제 주소가 올바르지 않습니다." }, { status: 400 }); }
  const topic = await getWikiTopic(auth.space.id, key);
  if (!topic) return Response.json({ error: "해당 주제를 찾을 수 없습니다." }, { status: 404 });
  return Response.json(topic);
}
