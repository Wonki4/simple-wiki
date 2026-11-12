// 로그인 후 돌아갈 경로는 같은 오리진의 상대 경로만 허용한다(오픈 리다이렉트 방지).
// "//evil.com"이나 "/\evil.com"은 브라우저가 프로토콜 상대 URL로 해석하므로 거부한다.
export function safeCallbackPath(value: string | null | undefined): string {
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.startsWith("/\\")) {
    return "/";
  }
  return value;
}
