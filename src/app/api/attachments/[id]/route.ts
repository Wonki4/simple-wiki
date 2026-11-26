import { NextRequest } from "next/server";
import { resolveApiActor, rateLimitResponse } from "@/lib/api-auth";
import { prisma } from "@/lib/db";
import { effectiveSpaceRole, hasRole } from "@/lib/permissions";
import { storage, StorageNotFoundError } from "@/lib/storage";
import { isPreviewableImage } from "@/lib/attachment-image";
import { createAttachmentThumbnail } from "@/lib/attachment-thumbnail";

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const actor = await resolveApiActor(req);
  if (!actor) return new Response("인증이 필요합니다.", { status: 401 });
  const limited = rateLimitResponse(actor);
  if (limited) return limited;

  const att = await prisma.attachment.findUnique({
    where: { id },
    include: { space: { include: { permissions: true } } },
  });
  if (!att) return new Response("없습니다.", { status: 404 });
  const role = effectiveSpaceRole(actor, att.space);
  if (!hasRole(role, "viewer")) return new Response("없습니다.", { status: 404 });

  const inline = isPreviewableImage(att.mime);
  const thumbnail = req.nextUrl.searchParams.get("preview") === "thumbnail";
  const etag = `W/"thumbnail-v1-${att.id}"`;
  const headers = {
    "Cache-Control": "private, no-cache",
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": "default-src 'none'; sandbox",
  };
  if (thumbnail) {
    if (!inline) return new Response(null, { status: 415 });
    // 각 첨부 ID의 원본은 불변이다. 권한을 재확인한 후에만 캐시를 재사용한다.
    if (req.headers.get("if-none-match")?.split(",").some(tag => tag.trim() === etag)) {
      return new Response(null, { status: 304, headers: { ...headers, ETag: etag } });
    }
  }
  let body: ReadableStream<Uint8Array>;
  try {
    body = await storage.get(att.storageKey);
  } catch (e) {
    // 스토리지-DB 불일치(오브젝트 소실)도 존재 은닉과 같은 404로
    if (e instanceof StorageNotFoundError) return new Response("없습니다.", { status: 404 });
    throw e;
  }
  if (thumbnail) {
    const image = await createAttachmentThumbnail(Buffer.from(await new Response(body).arrayBuffer()));
    if (!image) return new Response(null, { status: 415 });
    return new Response(new Uint8Array(image), {
      headers: { ...headers, "Content-Type": "image/webp", "Content-Length": String(image.length), ETag: etag },
    });
  }
  return new Response(body, {
    headers: {
      ...headers,
      "Content-Type": att.mime,
      "Content-Length": String(att.size),
      "Content-Disposition": `${inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(att.filename)}`,
    },
  });
}
