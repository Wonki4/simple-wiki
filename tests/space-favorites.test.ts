import { NextRequest } from "next/server";
import { expect, it, vi } from "vitest";
import { DELETE, PUT } from "@/app/api/spaces/[spaceKey]/favorite/route";

const { authorize, createMany, deleteMany } = vi.hoisted(() => ({
  authorize: vi.fn(), createMany: vi.fn(), deleteMany: vi.fn(),
}));
vi.mock("@/lib/api-auth", () => ({ requireApiSpaceRole: authorize }));
vi.mock("@/lib/db", () => ({ prisma: { spaceFavorite: { createMany, deleteMany } } }));

it.each([["PUT", PUT], ["DELETE", DELETE]] as const)(
  "읽기 전용 토큰의 %s 요청은 스페이스 열람 권한이 있어도 계정의 즐겨찾기를 변경하지 않는다",
  async (method, handler) => {
    authorize.mockResolvedValue({ ok: true, actor: { userId: "reader", tokenScope: { readOnly: true } },
      space: { id: "space-id" }, role: "viewer" });
    const request = new NextRequest("http://localhost/api/spaces/eng/favorite", { method });
    const response = await handler(request, { params: Promise.resolve({ spaceKey: "eng" }) });
    expect(response.status).toBe(403);
    expect(createMany).not.toHaveBeenCalled();
    expect(deleteMany).not.toHaveBeenCalled();
  },
);
