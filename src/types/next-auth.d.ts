import "next-auth";
import "next-auth/jwt";

declare module "next-auth" {
  interface Session {
    groups: string[];
    isWikiAdmin: boolean;
    user: { id: string; name?: string | null; email?: string | null };
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    groups?: string[];
    realmRoles?: string[];
  }
}
