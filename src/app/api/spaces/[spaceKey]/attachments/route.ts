import { NextRequest } from "next/server";
import { requireApiSpaceRole } from "@/lib/api-auth";
import { prisma } from "@/lib/db";
import { storage } from "@/lib/storage";
import { ATTACHMENT_SIZE_MESSAGE, MAX_ATTACHMENT_BYTES } from "@/lib/attachment-upload";

// 업로드는 웹 세션과 API 토큰(Bearer) 모두 허용한다. 판정·rate limit은 페이지 API와 동일.
export async function POST(req: NextRequest, ctx: { params: Promise<{ spaceKey: string }> }) {
  const { spaceKey } = await ctx.params;
  const auth = await requireApiSpaceRole(req, spaceKey, "editor");
  if (!auth.ok) return auth.response;

  const contentLength = Number(req.headers.get("content-length") ?? 0);
  if (contentLength > MAX_ATTACHMENT_BYTES + 1024 * 1024) {
    return Response.json({ error: ATTACHMENT_SIZE_MESSAGE }, { status: 413 });
  }

  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) return Response.json({ error: "file 필드가 필요합니다." }, { status: 400 });
  if (file.size > MAX_ATTACHMENT_BYTES) return Response.json({ error: ATTACHMENT_SIZE_MESSAGE }, { status: 413 });

  const key = `${auth.space.id}/${crypto.randomUUID()}`;
  await storage.put(key, Buffer.from(await file.arrayBuffer()));
  const att = await prisma.attachment.create({
    data: {
      spaceId: auth.space.id,
      filename: file.name || "attachment",
      mime: file.type || "application/octet-stream",
      size: file.size,
      storageKey: key,
      uploaderId: auth.actor.userId,
    },
  });

  return Response.json({ id: att.id, url: `/api/attachments/${att.id}`, filename: att.filename });
}
