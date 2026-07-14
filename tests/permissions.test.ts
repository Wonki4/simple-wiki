import { describe, it, expect } from "vitest";
import { resolveSpaceRole, hasRole, type SessionInfo, type PermissionEntry } from "@/lib/permissions";

// groups는 위키 자체 그룹(WikiGroup)의 id 목록이다 — Keycloak 클레임이 아니다.
const alice: SessionInfo = { userId: "alice-sub", groups: ["grp-eng"], isWikiAdmin: false };
const bob: SessionInfo = { userId: "bob-sub", groups: [], isWikiAdmin: false };
const admin: SessionInfo = { userId: "admin-sub", groups: [], isWikiAdmin: true };

const perms: PermissionEntry[] = [
  { subjectType: "group", subjectRef: "grp-eng", role: "editor" },
  { subjectType: "user", subjectRef: "bob-sub", role: "viewer" },
];

describe("resolveSpaceRole", () => {
  it("wiki-admin은 항상 admin", () => {
    expect(resolveSpaceRole(admin, "restricted", [])).toBe("admin");
  });
  it("위키 그룹 id 매칭", () => {
    expect(resolveSpaceRole(alice, "restricted", perms)).toBe("editor");
  });
  it("사용자 개별 권한 매칭", () => {
    expect(resolveSpaceRole(bob, "restricted", perms)).toBe("viewer");
  });
  it("restricted + 권한 없음 → null", () => {
    expect(resolveSpaceRole(bob, "restricted", [])).toBeNull();
  });
  it("organization + 권한 없음 → viewer", () => {
    expect(resolveSpaceRole(bob, "organization", [])).toBe("viewer");
  });
  it("여러 권한 중 가장 높은 역할", () => {
    const multi: PermissionEntry[] = [
      { subjectType: "group", subjectRef: "grp-eng", role: "viewer" },
      { subjectType: "user", subjectRef: "alice-sub", role: "admin" },
    ];
    expect(resolveSpaceRole(alice, "restricted", multi)).toBe("admin");
  });
});

describe("hasRole", () => {
  it("상위 역할은 하위 권한을 포함한다", () => {
    expect(hasRole("admin", "viewer")).toBe(true);
    expect(hasRole("editor", "viewer")).toBe(true);
    expect(hasRole("viewer", "editor")).toBe(false);
    expect(hasRole(null, "viewer")).toBe(false);
  });
});
