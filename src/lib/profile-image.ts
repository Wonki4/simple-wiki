// Keycloak's OIDC picture claim is an image URL, never inline markup or file data.
export function profileImageUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const input = value.trim();
  if (!input || input.length > 2048 || /[\u0000-\u001f\u007f]/.test(input)) return null;
  try {
    const url = new URL(input);
    if (!["https:", "http:"].includes(url.protocol) || url.username || url.password) return null;
    return url.href;
  } catch {
    return null;
  }
}

export function profileInitial(name: string): string {
  const trimmed = name.trim();
  if (!trimmed || trimmed === "알 수 없음") return "?";
  // Keep combined emoji and accented letters intact.
  return new Intl.Segmenter("ko", { granularity: "grapheme" })
    .segment(trimmed)[Symbol.iterator]().next().value!.segment.toUpperCase();
}
