import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextAuthConfig } from "next-auth";

const mocks = vi.hoisted(() => ({
  config: null as NextAuthConfig | null,
  upsert: vi.fn(), updateMany: vi.fn(),
}));
vi.mock("next-auth", () => ({ default: (config: NextAuthConfig) => {
  mocks.config = config;
  return {};
} }));
vi.mock("@/lib/db", () => ({ prisma: { user: { upsert: mocks.upsert, updateMany: mocks.updateMany } } }));
import "@/auth";

beforeEach(() => { vi.clearAllMocks(); });

describe("로그인 계정의 사진 동기화", () => {
  async function signIn(picture?: unknown) {
    const jwt = mocks.config!.callbacks!.jwt!;
    return jwt({ token: { picture: "https://id.example.com/old.png" }, trigger: "signIn",
      profile: { sub: "author-id", name: "한지우", preferred_username: "author", picture },
    } as Parameters<typeof jwt>[0]);
  }

  it("OIDC 사진을 DB의 생성·갱신 경로와 세션 토큰에 함께 저장한다", async () => {
    const imageUrl = "https://id.example.com/new.png";
    const token = await signIn(imageUrl);
    expect(token?.picture).toBe(imageUrl);
    expect(mocks.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "author-id" },
      create: expect.objectContaining({ imageUrl }),
      update: expect.objectContaining({ imageUrl }),
    }));
  });

  it.each([undefined, "", "javascript:alert(1)", { url: "https://id.example.com/a.png" }])(
    "사진이 삭제되거나 올바르지 않으면 이전 사진도 지운다: %s", async picture => {
      expect((await signIn(picture))?.picture).toBeNull();
      expect(mocks.upsert).toHaveBeenCalledWith(expect.objectContaining({
        update: expect.objectContaining({ imageUrl: null }),
      }));
    },
  );

  it("일반 세션 조회에서는 저장된 사진을 덮어쓰지 않는다", async () => {
    const jwt = mocks.config!.callbacks!.jwt!;
    const token = { sub: "author-id", picture: "https://id.example.com/a.png" };
    expect(await jwt({ token } as Parameters<typeof jwt>[0])).toEqual(token);
    expect(mocks.upsert).not.toHaveBeenCalled();
  });

  it("기존 토큰에 잘못된 사진 값이 있어도 세션에 노출하지 않는다", async () => {
    const callback = mocks.config!.callbacks!.session!;
    const session = await callback({ session: { user: {}, expires: "2099-01-01" },
      token: { sub: "author-id", picture: "javascript:alert(1)", isWikiAdmin: false },
    } as Parameters<typeof callback>[0]);
    expect(session.user).toMatchObject({ id: "author-id", image: null });
  });
});
