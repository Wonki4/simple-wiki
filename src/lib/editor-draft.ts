export interface PageDraft {
  title: string;
  content: string;
  expectedVersion?: number;
}

export function readDraft(key: string): PageDraft | null {
  try {
    const raw = sessionStorage.getItem(key);
    if (!raw) return null;
    const draft = JSON.parse(raw);
    if (typeof draft?.title !== "string" || typeof draft.content !== "string") return null;
    if (draft.expectedVersion !== undefined && !Number.isInteger(draft.expectedVersion)) return null;
    return draft;
  } catch {
    return null;
  }
}

export function storeDraft(key: string, draft: PageDraft | null): boolean {
  try {
    if (draft) sessionStorage.setItem(key, JSON.stringify(draft));
    else sessionStorage.removeItem(key);
    return true;
  } catch {
    return false;
  }
}
