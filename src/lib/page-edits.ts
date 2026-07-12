// 페이지 편집의 순수 로직(트랜잭션/DB 없음). pages.ts가 이 위에서 조합한다.

// 낙관적 잠금 충돌. currentVersion은 서버가 아는 현재 버전.
export class PageConflictError extends Error {
  currentVersion: number;
  constructor(currentVersion: number) {
    super("페이지가 그사이 변경되었습니다.");
    this.name = "PageConflictError";
    this.currentVersion = currentVersion;
  }
}

// replace 대상이 0곳이거나 2곳 이상, 또는 old_string이 빈 문자열일 때.
export class ReplaceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReplaceError";
  }
}

// expected가 주어졌고 current와 다르면 충돌. undefined면 검사 생략(last-write-wins).
export function assertExpectedVersion(current: number, expected: number | undefined): void {
  if (expected !== undefined && expected !== current) {
    throw new PageConflictError(current);
  }
}

// 본문 끝에 added를 덧붙인다. 기존 본문이 있으면 빈 줄 하나로 구분한다.
export function appendContent(current: string, added: string): string {
  const base = current.replace(/\s+$/, "");
  const tail = added.replace(/^\s+/, "").replace(/\s+$/, "");
  if (!base) return tail;
  if (!tail) return base;
  return `${base}\n\n${tail}`;
}

// old를 정확히 1곳에서 new로 치환한다. 0곳/2곳↑/빈 문자열이면 ReplaceError.
export function applyReplace(current: string, oldStr: string, newStr: string): string {
  if (oldStr === "") throw new ReplaceError("old_string이 비어 있습니다.");
  const parts = current.split(oldStr);
  const count = parts.length - 1;
  if (count === 0) throw new ReplaceError("old_string을 찾지 못했습니다.");
  if (count > 1) {
    throw new ReplaceError(`old_string이 ${count}곳에서 매치됩니다. 더 긴 고유 문맥을 포함하세요.`);
  }
  return parts.join(newStr);
}

// Prisma의 P2002(리비전 (pageId, version) 유니크 위반)인지 판별한다.
export function isVersionConflict(e: unknown): boolean {
  return (
    typeof e === "object" &&
    e !== null &&
    "code" in e &&
    (e as { code: unknown }).code === "P2002"
  );
}
