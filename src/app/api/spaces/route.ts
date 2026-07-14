import { NextRequest } from "next/server";
import { resolveApiActor, rateLimitResponse } from "@/lib/api-auth";
import { listReadableSpaces } from "@/lib/access";
import { resolveSpaceRole } from "@/lib/permissions";

// GET /api/spaces — 읽기 권한이 있는 스페이스 목록
export async function GET(req: NextRequest) {
  const actor = await resolveApiActor(req);
  if (!actor) return Response.json({ error: "인증이 필요합니다." }, { status: 401 });
  const limited = rateLimitResponse(actor);
  if (limited) return limited;

  const spaces = await listReadableSpaces(actor);
  return Response.json({
    spaces: spaces.map((s) => ({
      key: s.key,
      name: s.name,
      description: s.description,
      visibility: s.visibility,
      role: resolveSpaceRole(actor, s.visibility, s.permissions),
    })),
  });
}
