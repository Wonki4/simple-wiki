import type { SpaceRole } from "@prisma/client";

export interface PermissionSubject {
  id: string;
  type: "user" | "group";
  label: string;
  detail: string;
  currentRole: SpaceRole | null;
}

export interface PermissionSearchResult {
  items: PermissionSubject[];
  hasMore: boolean;
}

export interface PermissionActionState {
  error?: string;
  success?: string;
}
