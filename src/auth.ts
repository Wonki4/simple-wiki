import NextAuth from "next-auth";
import Keycloak from "next-auth/providers/keycloak";
import { prisma } from "@/lib/db";

// User.id = Keycloak sub. 첫 로그인(및 매 로그인) 시 프로필을 upsert한다.
export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [Keycloak],
  // 관리자 판정(realm_roles/WIKI_ADMIN_GROUP)은 로그인 시점에만 갱신되므로 세션을 짧게 유지해
  // Keycloak에서 회수된 관리자 권한이 최대 8시간 내에 만료되도록 한다.
  // 스페이스 권한은 WikiGroup(DB) 기준이라 세션 수명과 무관하게 즉시 반영된다.
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
        token.sub = p.sub;
        token.realmRoles = roles;
        const groups = p.groups ?? [];
        // 전역 관리자: realm 역할 wiki-admin 또는 WIKI_ADMIN_GROUP으로 지정한 그룹(전체 경로) 소속.
        // 역할 클레임을 못 내려주는 IdP 연계 환경에서는 그룹 쪽 경로만으로 관리자를 운영할 수 있다.
        const adminGroup = process.env.WIKI_ADMIN_GROUP;
        const isWikiAdmin =
          roles.includes("wiki-admin") || (!!adminGroup && groups.includes(adminGroup));
        token.isWikiAdmin = isWikiAdmin;
        // 권한 문제 진단용: 로그인 시점에 ID 토큰에서 실제로 읽은 클레임과 판정 결과를 남긴다.
        console.log(
          `[auth] signIn sub=${p.sub} user=${p.preferred_username ?? p.email ?? ""} realm_roles=${JSON.stringify(p.realm_roles ?? null)} realm_access.roles=${JSON.stringify(p.realm_access?.roles ?? null)} resource_access[${clientId}].roles=${JSON.stringify(p.resource_access?.[clientId]?.roles ?? null)} groups=${JSON.stringify(p.groups ?? null)} -> isWikiAdmin=${isWikiAdmin}`
        );
        const name = p.name ?? p.preferred_username ?? "";
        // 재생성된 Keycloak 계정(sub는 바뀌고 username은 동일) 등으로 다른 행이
        // username을 점유하고 있으면 upsert가 P2002로 실패해 로그인 자체가 막힌다 — 선점 해제.
        if (p.preferred_username) {
          await prisma.user.updateMany({
            where: { username: p.preferred_username, NOT: { id: p.sub } },
            data: { username: null },
          });
        }
        // 프로필과 관리자 판정 스냅샷을 User에 저장 — 스페이스 권한은 WikiGroup(DB)에서 판정한다.
        await prisma.user.upsert({
          where: { id: p.sub },
          update: { email: p.email ?? "", name, username: p.preferred_username ?? null, isWikiAdmin },
          create: { id: p.sub, email: p.email ?? "", name, username: p.preferred_username ?? null, isWikiAdmin },
        });
      }
      return token;
    },
    async session({ session, token }) {
      session.user.id = token.sub!;
      session.isWikiAdmin = (token.isWikiAdmin as boolean | undefined) ?? false;
      return session;
    },
  },
});
