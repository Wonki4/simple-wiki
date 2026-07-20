// 페이지 트리 순수 로직 — DB 무관. 서버(액션·페이지)와 클라이언트(사이드바) 양쪽에서 쓴다.

export interface TreePageInput {
  id: string;
  slug: string;
  title: string;
  parentId: string | null;
}

export interface TreeNode extends TreePageInput {
  children: TreeNode[];
}

// 형제 정렬 비교자. ICU의 "ko" 콜레이션은 한글이 라틴 문자보다 먼저 오도록 스크립트를
// 재정렬하는 경우가 있어(Node 버전/ICU 데이터에 따라 갈림), 라틴 시작 문자열을 항상
// 먼저 오도록 우선 나눈 뒤, 같은 스크립트끼리는 "ko" 콜레이션으로 비교해 한글 자모
// 순서를 올바르게 지킨다.
function compareTitles(a: string, b: string): number {
  const scriptRank = (s: string) => (/^[\x00-\x7F]/.test(s) ? 0 : 1);
  const rankDiff = scriptRank(a) - scriptRank(b);
  if (rankDiff !== 0) return rankDiff;
  return a.localeCompare(b, "ko");
}

// 플랫 목록 → 형제 제목순 트리. parentId가 목록에 없는 문서(이론상 고아)는 최상위로 올린다.
export function buildTree(pages: TreePageInput[]): TreeNode[] {
  const nodes = new Map<string, TreeNode>();
  for (const p of pages) nodes.set(p.id, { ...p, children: [] });
  const roots: TreeNode[] = [];
  for (const node of nodes.values()) {
    const parent = node.parentId ? nodes.get(node.parentId) : undefined;
    if (parent) parent.children.push(node);
    else roots.push(node);
  }
  const sortRec = (list: TreeNode[]) => {
    list.sort((a, b) => compareTitles(a.title, b.title));
    for (const n of list) sortRec(n.children);
  };
  sortRec(roots);
  return roots;
}

// rootId 자신 + 모든 자손의 id 집합 — 이동 시 순환 방지용.
export function selfAndDescendantIds(
  pages: { id: string; parentId: string | null }[],
  rootId: string,
): Set<string> {
  const childrenOf = new Map<string, string[]>();
  for (const p of pages) {
    if (!p.parentId) continue;
    const arr = childrenOf.get(p.parentId) ?? [];
    arr.push(p.id);
    childrenOf.set(p.parentId, arr);
  }
  const result = new Set<string>([rootId]);
  const stack = [rootId];
  while (stack.length > 0) {
    const cur = stack.pop()!;
    for (const child of childrenOf.get(cur) ?? []) {
      if (!result.has(child)) {
        result.add(child);
        stack.push(child);
      }
    }
  }
  return result;
}

// 트리 → 들여쓰기 depth를 가진 플랫 목록. 이동 드롭다운·MCP 텍스트 표기용.
export function flattenTree(
  roots: TreeNode[],
  depth = 0,
): { id: string; slug: string; title: string; depth: number }[] {
  const out: { id: string; slug: string; title: string; depth: number }[] = [];
  for (const n of roots) {
    out.push({ id: n.id, slug: n.slug, title: n.title, depth });
    out.push(...flattenTree(n.children, depth + 1));
  }
  return out;
}
