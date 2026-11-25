import { createHash } from "node:crypto";
import { JsonInputError, readBoundedJson } from "./bounded-json";
import { formatKstDay, isTimelineDay } from "./timeline-period";

interface EntryInput {
  kind: "discussion" | "decision";
  summary: string;
  evidence: string;
  date?: string;
}

export interface TimelineWriteInput {
  version: number;
  entries: EntryInput[];
}

function validText(value: unknown, maxLength: number): value is string {
  return typeof value === "string" && !!value.trim() && value.length <= maxLength &&
    !value.includes("\0") && value.isWellFormed();
}

export async function readTimelineInput(request: Request): Promise<TimelineWriteInput> {
  // Enough for 50 maximum-length entries even with every UTF-16 unit JSON-escaped.
  const body = await readBoundedJson(request, 768 * 1024, "타임라인 요청이 너무 큽니다.");
  if (!body || typeof body !== "object") throw new JsonInputError("JSON 객체가 필요합니다.");
  const { version, entries } = body as Record<string, unknown>;
  if (typeof version !== "number" || !Number.isInteger(version) || version < 1 || version > 2147483647) {
    throw new JsonInputError("원문에서 읽은 문서 버전이 필요합니다.");
  }
  if (!Array.isArray(entries) || entries.length > 50) throw new JsonInputError("항목은 최대 50개까지 보낼 수 있습니다.");
  return { version, entries: entries.map((item: unknown) => {
    if (!item || typeof item !== "object") throw new JsonInputError("타임라인 항목을 확인하세요.");
    const { kind, summary, evidence, date } = item as Record<string, unknown>;
    if (kind !== "discussion" && kind !== "decision") throw new JsonInputError("종류는 discussion 또는 decision이어야 합니다.");
    if (!validText(summary, 240) || /[\r\n\u2028\u2029]/.test(summary)) throw new JsonInputError("240자 이하의 한 줄 요약이 필요합니다.");
    if (!validText(evidence, 2000)) throw new JsonInputError("원문에서 가져온 2,000자 이하의 근거 문장이 필요합니다.");
    if (date !== undefined && (typeof date !== "string" || !isTimelineDay(date))) {
      throw new JsonInputError("회의 날짜는 YYYY-MM-DD 형식이어야 합니다.");
    }
    return { kind, summary: summary.trim(), evidence, date };
  }) };
}

// Support dated meeting titles as well as dates written in the Markdown document.
function mentionsDate(text: string, date: string): boolean {
  const [year, month, day] = date.split("-");
  const m = Number(month);
  const d = Number(day);
  const match = new RegExp(`(?:^|[^0-9])${year}(?:([./-])\\s*0?${m}\\1\\s*0?${d}(?![0-9])|\\s*년\\s*0?${m}\\s*월\\s*0?${d}\\s*일)`);
  return match.test(text);
}

export function timelineRows(
  revision: { id: string; pageId: string; version: number; title: string; content: string; createdAt: Date },
  entries: EntryInput[],
) {
  const recordedDay = formatKstDay(revision.createdAt);
  const seen = new Set<string>();
  return entries.map(({ kind, summary, evidence, date }) => {
    if (!revision.content.includes(evidence)) throw new JsonInputError("근거 문장이 해당 버전의 원문과 일치하지 않습니다.");
    if (date && !mentionsDate(revision.title, date) && !mentionsDate(revision.content, date)) {
      throw new JsonInputError("지정한 날짜를 해당 버전의 제목이나 원문에서 찾을 수 없습니다.");
    }
    // Exclude generated summary, revision number and fallback day from the identity:
    // the same undated sentence carried forward is one event even when its summary changes.
    const normalized = evidence.normalize("NFC").trim().replace(/\s+/gu, " ");
    const fingerprint = createHash("sha256").update(JSON.stringify([kind, normalized, date ?? null])).digest("hex");
    if (seen.has(fingerprint)) throw new JsonInputError("한 요청에 같은 타임라인 항목이 두 번 포함되어 있습니다.");
    seen.add(fingerprint);
    return {
      id: createHash("sha256").update(JSON.stringify([revision.id, fingerprint])).digest("hex"),
      revisionId: revision.id, pageId: revision.pageId, version: revision.version, fingerprint,
      kind, summary, evidence, explicitDate: date !== undefined,
      eventDay: new Date(`${date ?? recordedDay}T00:00:00Z`),
    };
  });
}
