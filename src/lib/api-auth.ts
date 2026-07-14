import { createHash, randomBytes } from "node:crypto";
import type { NextRequest } from "next/server";
import type { Space, SpacePermission } from "@prisma/client";
import { prisma } from "@/lib/db";
import { getSessionInfo, getWikiGroupIds } from "@/lib/access";
import { hasRole, resolveSpaceRole, type SessionInfo, type SpaceRole } from "@/lib/permissions";
import { checkTokenRateLimit } from "@/lib/rate-limit";

const TOKEN_PREFIX = "swk_";

export function generateToken(): { raw: string; hash: string; prefix: string } {
  const raw = TOKEN_PREFIX + randomBytes(32).toString("base64url");
  return { raw, hash: hashToken(raw), prefix: raw.slice(0, 12) };
}

export function hashToken(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

// 행위자 + 인증 경로. via="token"이면 봇/LLM 편집으로 간주하고 tokenName을 표시에 쓴다.
export type ApiActor = SessionInfo & { via: "token" | "session"; tokenName: string | null; tokenId: string | null };

/**
 * API 요청의 행위자를 판정한다.
 * 1) Authorization: Bearer swk_... 개인 액세스 토큰 → 해당 사용자(그룹은 요청 시 DB 조회로 즉시 반영, 관리자 여부는 로그인 시점 스냅샷)
 * 2) 없으면 브라우저 세션 쿠키로 폴백
 * 인증 실패 시 null.
 */
export async function resolveApiActor(req: NextRequest): Promise<ApiActor | null> {
  const auth = req.headers.get("authorization");
  if (auth?.startsWith("Bearer ")) {
    const raw = auth.slice(7).trim();
    if (raw.startsWith(TOKEN_PREFIX)) {
      const token = await prisma.apiToken.findUnique({
        where: { tokenHash: hashToken(raw) },
        include: { user: true },
      });
      if (!token) return null;
      // 마지막 사용 시각 갱신은 60초에 한 번만(핫로우 쓰기 증폭 방지). 실패해도 요청은 진행.
      if (!token.lastUsedAt || Date.now() - token.lastUsedAt.getTime() > 60_000) {
        prisma.apiToken
          .update({ where: { id: token.id }, data: { lastUsedAt: new Date() } })
          .catch(() => {});
      }
      return {
        userId: token.user.id,
        groups: await getWikiGroupIds(token.user.id),
        isWikiAdmin: token.user.isWikiAdmin,
        via: "token",
        tokenName: token.name,
        tokenId: token.id,
      };
    }
    return null;
  }
  const s = await getSessionInfo();
  return s ? { ...s, via: "session", tokenName: null, tokenId: null } : null;
}

/**
 * 토큰 행위자가 rate limit을 초과하면 429 Response를 반환한다. 아니면 null.
 * 세션(사람) 행위자는 검사하지 않는다.
 */
export function rateLimitResponse(actor: ApiActor): Response | null {
  if (actor.via !== "token" || !actor.tokenId) return null;
  const r = checkTokenRateLimit(actor.tokenId);
  if (r.allowed) return null;
  return Response.json(
    { error: "요청이 너무 많습니다. 잠시 후 다시 시도하세요." },
    { status: 429, headers: { "Retry-After": String(r.retryAfterSec) } },
  );
}

type SpaceWithPermissions = Space & { permissions: SpacePermission[] };

interface SpaceAuthOk {
  ok: true;
  actor: ApiActor;
  space: SpaceWithPermissions;
  role: SpaceRole;
}
interface SpaceAuthErr {
  ok: false;
  response: Response;
}

/**
 * API 요청에 대해 스페이스 권한을 판정한다. 브라우저의 requireSpaceRole과 같은
 * 404 은닉 규칙을 따르되, redirect/notFound 대신 JSON 상태코드를 반환한다.
 * - 미인증 → 401
 * - 스페이스 없음/무권한(restricted 은닉) → 404
 * - 역할 부족 → 403
 */
export async function requireApiSpaceRole(
  req: NextRequest,
  spaceKey: string,
  required: SpaceRole,
): Promise<SpaceAuthOk | SpaceAuthErr> {
  const actor = await resolveApiActor(req);
  if (!actor) {
    return { ok: false, response: Response.json({ error: "인증이 필요합니다." }, { status: 401 }) };
  }
  const limited = rateLimitResponse(actor);
  if (limited) return { ok: false, response: limited };
  const space = await prisma.space.findUnique({
    where: { key: spaceKey },
    include: { permissions: true },
  });
  if (!space) {
    return { ok: false, response: Response.json({ error: "스페이스가 없습니다." }, { status: 404 }) };
  }
  const role = resolveSpaceRole(actor, space.visibility, space.permissions);
  if (role === null) {
    return { ok: false, response: Response.json({ error: "스페이스가 없습니다." }, { status: 404 }) };
  }
  if (!hasRole(role, required)) {
    return { ok: false, response: Response.json({ error: "권한이 부족합니다." }, { status: 403 }) };
  }
  return { ok: true, actor, space, role };
}
