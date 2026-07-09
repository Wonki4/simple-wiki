import { NextRequest } from "next/server";
import { getSessionInfo } from "@/lib/access";
import { prisma } from "@/lib/db";
import { hasRole, resolveSpaceRole } from "@/lib/permissions";
import { storage } from "@/lib/storage";

const MAX_SIZE = 20 * 1024 * 1024;

export async function POST(req: NextRequest, ctx: { params: Promise<{ spaceKey: string }> }) {
  const { spaceKey } = await ctx.params;
  const session = await getSessionInfo();
  if (!session) return Response.json({ error: "로그인이 필요합니다." }, { status: 401 });

  const space = await prisma.space.findUnique({
    where: { key: spaceKey },
    include: { permissions: true },
  });
  if (!space) return Response.json({ error: "스페이스가 없습니다." }, { status: 404 });
  const role = resolveSpaceRole(session, space.visibility, space.permissions);
  if (role === null) return Response.json({ error: "스페이스가 없습니다." }, { status: 404 });
  if (!hasRole(role, "editor")) return Response.json({ error: "편집 권한이 필요합니다." }, { status: 403 });

  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) return Response.json({ error: "file 필드가 필요합니다." }, { status: 400 });
  if (file.size > MAX_SIZE) return Response.json({ error: "20MB 이하만 업로드할 수 있습니다." }, { status: 413 });

  const key = `${space.id}/${crypto.randomUUID()}`;
  await storage.put(key, Buffer.from(await file.arrayBuffer()));
  const att = await prisma.attachment.create({
    data: {
      spaceId: space.id,
      filename: file.name || "attachment",
      mime: file.type || "application/octet-stream",
      size: file.size,
      storageKey: key,
      uploaderId: session.userId,
    },
  });

  return Response.json({ id: att.id, url: `/api/attachments/${att.id}`, filename: att.filename });
}
