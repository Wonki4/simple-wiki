import { NextResponse, type NextRequest } from "next/server";

// 서버 컴포넌트/액션은 현재 URL을 알 수 없어서, 세션 만료 시 재로그인 후 원래 페이지로
// 돌아갈 수 있도록 요청 경로를 헤더로 전달한다(requireSession에서 사용).
export function middleware(req: NextRequest) {
  const headers = new Headers(req.headers);
  headers.set("x-pathname", req.nextUrl.pathname + req.nextUrl.search);
  return NextResponse.next({ request: { headers } });
}

export const config = {
  matcher: ["/((?!api/|_next/|favicon.ico).*)"],
};
