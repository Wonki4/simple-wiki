import { prisma } from "@/lib/db";

// 권한 부여 대상 검색: 이메일 정확 일치 우선, 없으면 Keycloak 로그인 아이디(username).
// username은 unique라 모호성이 없다. 컬럼 도입 전 로그인한 사용자는 다음 로그인까지 username이 null이다.
export async function findUserByEmailOrUsername(value: string) {
  return (
    (await prisma.user.findFirst({ where: { email: value }, orderBy: { createdAt: "desc" } })) ??
    (await prisma.user.findUnique({ where: { username: value } }))
  );
}
