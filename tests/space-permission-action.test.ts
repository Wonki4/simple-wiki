import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  access: vi.fn(), group: vi.fn(), user: vi.fn(), upsert: vi.fn(), revalidate: vi.fn(),
}));
vi.mock("@/lib/access", () => ({ requireSpaceRole: mocks.access }));
vi.mock("@/lib/db", () => ({ prisma: {
  wikiGroup: { findUnique: mocks.group }, user: { findUnique: mocks.user }, spacePermission: { upsert: mocks.upsert },
} }));
vi.mock("@/lib/storage", () => ({ storage: {} }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidate }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
import { addSpacePermission } from "@/actions/spaces";

function data(type = "user", ref = "user-id", role = "viewer") {
  const form = new FormData();
  form.set("subjectType", type); form.set("subjectRef", ref); form.set("role", role);
  return form;
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.access.mockResolvedValue({ space: { id: "space-id" } });
  mocks.user.mockResolvedValue({ id: "user-id" });
  mocks.group.mockResolvedValue({ id: "group-id" });
});

describe("통합 권한 저장의 서버 검증", () => {
  it.each([data("invalid"), data("user", ""), data("user", "user-id", "owner")])("잘못된 대상 유형·id·역할은 저장하지 않는다", async form => {
    expect((await addSpacePermission("eng", {}, form)).error).toBeTruthy();
    expect(mocks.upsert).not.toHaveBeenCalled();
  });
  it("검색 이후 권한이 회수되면 저장을 거부한다", async () => {
    mocks.access.mockRejectedValue(new Error("denied"));
    await expect(addSpacePermission("eng", {}, data())).rejects.toThrow("denied");
    expect(mocks.access).toHaveBeenCalledWith("eng", "admin");
    expect(mocks.upsert).not.toHaveBeenCalled();
  });
  it("없는 사용자는 저장하지 않는다", async () => {
    mocks.user.mockResolvedValue(null);
    expect((await addSpacePermission("eng", {}, data())).error).toContain("존재하지 않습니다");
    expect(mocks.upsert).not.toHaveBeenCalled();
  });
});
