import type { NextRequest } from "next/server";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { signIn } from "@/auth";
import { safeCallbackPath } from "@/lib/callback-path";

// 세션 만료 시 Auth.js 기본 로그인 페이지(버튼 한 번 더 클릭) 대신 곧장 Keycloak으로 보낸다.
// Keycloak SSO 세션이 살아 있으면 로그인 화면 없이 즉시 돌아오므로 사용자에겐 자동 로그인처럼 보인다.
export async function GET(req: NextRequest) {
  if ((await cookies()).get("swk_manual_logout")?.value === "1") redirect("/");
  const redirectTo = safeCallbackPath(req.nextUrl.searchParams.get("callbackUrl"));
  await signIn("keycloak", { redirectTo });
}
