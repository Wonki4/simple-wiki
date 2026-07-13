export type SpaceRole = "viewer" | "editor" | "admin";
export type SpaceVisibility = "organization" | "restricted";

export interface SessionInfo {
  userId: string;
  groups: string[];
  isWikiAdmin: boolean;
}

export interface PermissionEntry {
  subjectType: "user" | "group";
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
