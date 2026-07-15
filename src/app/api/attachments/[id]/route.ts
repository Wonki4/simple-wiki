import { NextRequest } from "next/server";
import { getSessionInfo } from "@/lib/access";
import { prisma } from "@/lib/db";
import { hasRole, resolveSpaceRole } from "@/lib/permissions";
import { storage, StorageNotFoundError } from "@/lib/storage";

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

  let body: ReadableStream<Uint8Array>;
  try {
    body = await storage.get(att.storageKey);
  } catch (e) {
    // 스토리지-DB 불일치(오브젝트 소실)도 존재 은닉과 같은 404로
    if (e instanceof StorageNotFoundError) return new Response("없습니다.", { status: 404 });
    throw e;
  }
  // SVG 등 스크립트 실행이 가능한 타입은 인라인 금지: 래스터 이미지만 허용목록으로 명시
  const baseMime = att.mime.split(";")[0].trim().toLowerCase();
  const inline = ["image/png", "image/jpeg", "image/gif", "image/webp"].includes(baseMime);
  return new Response(body, {
    headers: {
      "Content-Type": att.mime,
      "Content-Length": String(att.size),
      "Content-Disposition": `${inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(att.filename)}`,
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
      "Cache-Control": "private, no-cache",
    },
  });
}
