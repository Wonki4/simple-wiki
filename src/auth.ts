import NextAuth from "next-auth";
import Keycloak from "next-auth/providers/keycloak";
import { prisma } from "@/lib/db";

// User.id = Keycloak sub. 첫 로그인(및 매 로그인) 시 프로필을 upsert한다.
export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [Keycloak],
  // 권한 클레임(groups/realm_roles)은 로그인 시점에만 갱신되므로 세션을 짧게 유지해
  // Keycloak에서 회수된 권한이 최대 8시간 내에 만료되도록 한다.
  session: { maxAge: 8 * 60 * 60 },
  callbacks: {
    async jwt({ token, profile, trigger }) {
      if (trigger === "signIn" && profile?.sub) {
        const p = profile as {
          sub: string;
          email?: string;
          name?: string;
          preferred_username?: string;
          groups?: string[];
          realm_roles?: string[];
          roles?: string[];
          realm_access?: { roles?: string[] };
          resource_access?: Record<string, { roles?: string[] }>;
        };
        // 역할 클레임은 Keycloak 매퍼 구성에 따라 위치가 달라서 표준 위치를 모두 합쳐 본다.
        // resource_access는 우리 클라이언트 것만 — 다른 클라이언트의 역할로 관리자가 되면 안 된다.
        const clientId = process.env.AUTH_KEYCLOAK_ID ?? "";
        const roles = Array.from(
          new Set([
            ...(p.realm_roles ?? []),
            ...(p.roles ?? []),
            ...(p.realm_access?.roles ?? []),
            ...(p.resource_access?.[clientId]?.roles ?? []),
          ])
        );
        // 권한 문제 진단용: 로그인 시점에 ID 토큰에서 실제로 읽은 클레임을 남긴다.
        console.log(
          `[auth] signIn sub=${p.sub} user=${p.preferred_username ?? p.email ?? ""} realm_roles=${JSON.stringify(p.realm_roles ?? null)} realm_access.roles=${JSON.stringify(p.realm_access?.roles ?? null)} resource_access[${clientId}].roles=${JSON.stringify(p.resource_access?.[clientId]?.roles ?? null)} groups=${JSON.stringify(p.groups ?? null)}`
        );
        token.sub = p.sub;
        token.groups = p.groups ?? [];
        token.realmRoles = roles;
        const groups = p.groups ?? [];
        const isWikiAdmin = roles.includes("wiki-admin");
        const name = p.name ?? p.preferred_username ?? "";
        // 권한 스냅샷을 User에 저장 — API 토큰 요청이 이 값으로 권한을 판정한다.
        await prisma.user.upsert({
          where: { id: p.sub },
          update: { email: p.email ?? "", name, groups, isWikiAdmin },
          create: { id: p.sub, email: p.email ?? "", name, groups, isWikiAdmin },
        });
      }
      return token;
    },
    async session({ session, token }) {
      session.user.id = token.sub!;
      session.groups = (token.groups as string[]) ?? [];
      session.isWikiAdmin = ((token.realmRoles as string[]) ?? []).includes("wiki-admin");
      return session;
    },
  },
});
