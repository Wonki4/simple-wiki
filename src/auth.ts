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
        };
        token.sub = p.sub;
        token.groups = p.groups ?? [];
        token.realmRoles = p.realm_roles ?? [];
        await prisma.user.upsert({
          where: { id: p.sub },
          update: { email: p.email ?? "", name: p.name ?? p.preferred_username ?? "" },
          create: { id: p.sub, email: p.email ?? "", name: p.name ?? p.preferred_username ?? "" },
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
