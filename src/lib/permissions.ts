export type SpaceRole = "viewer" | "editor" | "admin";
export type SpaceVisibility = "organization" | "restricted";

export interface SessionInfo {
  userId: string;
  /** 내가 속한 WikiGroup id 목록 (요청 시 DB 조회 — 클레임 스냅샷 아님) */
  groups: string[];
  isWikiAdmin: boolean;
  tokenScope?: { readOnly: boolean; spaceId: string | null };
}

export interface PermissionEntry {
  subjectType: "user" | "group";
  /** user면 User.id(=Keycloak sub), group이면 WikiGroup.id */
  subjectRef: string;
  role: SpaceRole;
}

const LEVEL: Record<SpaceRole, number> = { viewer: 1, editor: 2, admin: 3 };

export function resolveSpaceRole(
  session: SessionInfo,
  visibility: SpaceVisibility,
  permissions: PermissionEntry[],
): SpaceRole | null {
  if (session.isWikiAdmin) return "admin";
  let best: SpaceRole | null = null;
  for (const p of permissions) {
    const matches =
      p.subjectType === "user"
        ? p.subjectRef === session.userId
        : session.groups.includes(p.subjectRef);
    if (matches && (best === null || LEVEL[p.role] > LEVEL[best])) best = p.role;
  }
  if (best === null && visibility === "organization") return "viewer";
  return best;
}

export function hasRole(actual: SpaceRole | null, required: SpaceRole): boolean {
  return actual !== null && LEVEL[actual] >= LEVEL[required];
}

// 토큰 범위는 발급자에게 현재 허용된 권한을 좁힐 수만 있다.
export function effectiveSpaceRole(session: SessionInfo, space: {
  id: string; visibility: SpaceVisibility; permissions: PermissionEntry[];
}): SpaceRole | null {
  const scope = session.tokenScope;
  if (scope?.spaceId != null && scope.spaceId !== space.id) return null;
  const role = resolveSpaceRole(session, space.visibility, space.permissions);
  return role && scope?.readOnly ? "viewer" : role;
}
