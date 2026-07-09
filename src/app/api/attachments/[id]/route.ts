import { NextRequest } from "next/server";
import { getSessionInfo } from "@/lib/access";
import { prisma } from "@/lib/db";
import { hasRole, resolveSpaceRole } from "@/lib/permissions";
import { storage } from "@/lib/storage";

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const session = await getSessionInfo();
  if (!session) return new Response("로그인이 필요합니다.", { status: 401 });

  const att = await prisma.attachment.findUnique({
    where: { id },
    include: { space: { include: { permissions: true } } },
  });
  if (!att) return new Response("없습니다.", { status: 404 });
  const role = resolveSpaceRole(session, att.space.visibility, att.space.permissions);
  if (!hasRole(role, "viewer")) return new Response("없습니다.", { status: 404 });

  const data = await storage.get(att.storageKey);
  // SVG는 스크립트 실행이 가능하므로 inline 금지
  const inline = att.mime.startsWith("image/") && att.mime !== "image/svg+xml";
  return new Response(new Uint8Array(data), {
    headers: {
      "Content-Type": att.mime,
      "Content-Disposition": `${inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(att.filename)}`,
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, no-cache",
    },
  });
}
