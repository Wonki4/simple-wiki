import { notFound, redirect } from "next/navigation";
import type { Space, SpacePermission } from "@prisma/client";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { hasRole, resolveSpaceRole, type SessionInfo, type SpaceRole } from "@/lib/permissions";

export type SpaceWithPermissions = Space & { permissions: SpacePermission[] };

// 요청 시점의 위키 그룹 멤버십 조회. 세션/토큰의 클레임 스냅샷 대신 이 값으로
// 스페이스 권한을 판정하므로 그룹 변경이 재로그인 없이 즉시 반영된다.
export async function getWikiGroupIds(userId: string): Promise<string[]> {
  const rows = await prisma.wikiGroupMember.findMany({
    where: { userId },
    select: { groupId: true },
  });
  return rows.map((r) => r.groupId);
}

export async function getSessionInfo(): Promise<SessionInfo | null> {
  const session = await auth();
  if (!session?.user?.id) return null;
  return {
    userId: session.user.id,
    groups: await getWikiGroupIds(session.user.id),
    isWikiAdmin: session.isWikiAdmin ?? false,
  };
}

export async function requireSession(): Promise<SessionInfo> {
  const session = await getSessionInfo();
  if (!session) redirect("/api/auth/signin");
  return session;
}

export async function requireSpaceRole(spaceKey: string, required: SpaceRole) {
  const session = await requireSession();
  const space = await prisma.space.findUnique({
    where: { key: spaceKey },
    include: { permissions: true },
  });
  if (!space) notFound();
  const role = resolveSpaceRole(session, space.visibility, space.permissions);
  if (!hasRole(role, required)) {
    // 스페이스 자체를 볼 수 없으면 존재를 숨긴다(404). 볼 수는 있는데 역할이 부족하면 403 성격의 /denied.
    if (role === null) notFound();
    redirect("/denied");
  }
  return { session, space, role: role! };
}

export async function listReadableSpaces(session: SessionInfo): Promise<SpaceWithPermissions[]> {
  const spaces = await prisma.space.findMany({
    include: { permissions: true },
    orderBy: { name: "asc" },
  });
  return spaces.filter((s) => hasRole(resolveSpaceRole(session, s.visibility, s.permissions), "viewer"));
}
