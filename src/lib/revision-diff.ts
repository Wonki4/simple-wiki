import { diffLines } from "diff";

export interface DiffBlock {
  kind: "add" | "remove" | "context";
  lines: string[];
}

export function diffMarkdown(before: string, after: string): DiffBlock[] | null {
  if (before === after) return [];
  // 서로 다른 거대 문서의 최악 경우에도 서버 이벤트 루프를 장시간 점유하지 않는다.
  const changes = diffLines(before, after, { timeout: 150, maxEditLength: 4000 });
  if (!changes) return null;
  return changes.map(change => {
    const lines = change.value.match(/[^\n]*\n|[^\n]+$/g) ?? [];
    return {
      kind: change.added ? "add" : change.removed ? "remove" : "context",
      lines: lines.map(line => {
        if (line.endsWith("\r\n")) return line.slice(0, -2) + " ␍";
        if (line.endsWith("\n")) return line.slice(0, -1);
        return line + " ⏎ 없음";
      }),
    };
  });
}
