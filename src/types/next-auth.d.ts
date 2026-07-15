import "next-auth";
import "next-auth/jwt";

declare module "next-auth" {
  interface Session {
    isWikiAdmin: boolean;
    user: { id: string; name?: string | null; email?: string | null };
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    realmRoles?: string[];
    isWikiAdmin?: boolean;
  }
}
