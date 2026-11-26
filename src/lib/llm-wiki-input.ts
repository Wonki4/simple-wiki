import type { WikiItemKind } from "@prisma/client";
import { JsonInputError, readBoundedJson } from "./bounded-json";

export interface WikiItemChange {
  key: string;
  kind: WikiItemKind;
  text: string;
  evidence: string;
}

export interface WikiTopicPatch {
  key: string;
  title: string;
  expectedVersion: number;
  changes: WikiItemChange[];
}

export interface WikiWriteInput {
  pageId?: string;
  version: number;
  topics: WikiTopicPatch[];
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new JsonInputError("JSON 객체가 필요합니다.");
  return value as Record<string, unknown>;
}

function validString(value: unknown, max: number): value is string {
  return typeof value === "string" && value.length <= max && value.isWellFormed() && !value.includes("\0");
}

function requiredText(value: unknown, name: string, max: number) {
  if (!validString(value, max) || !value.trim()) throw new JsonInputError(`${name} 항목은 1~${max}자여야 합니다.`);
  return value;
}

export function validWikiKey(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const key = value.normalize("NFC");
  return key.length <= 80 && /^[\p{L}\p{N}_-]+$/u.test(key) ? key : null;
}

function requireKey(value: unknown) {
  const key = validWikiKey(value);
  if (!key) throw new JsonInputError("키는 문자, 숫자, 하이픈, 밑줄로 구성한 1~80자여야 합니다.");
  return key;
}

function versionNumber(value: unknown, min: number, max: number) {
  if (typeof value !== "number" || !Number.isInteger(value) || value < min || value > max) {
    throw new JsonInputError("문서 버전과 주제 버전을 확인하세요. 새 주제의 expectedVersion은 0입니다.");
  }
  return value;
}

function uniqueKeys(items: { key: string }[]) {
  if (new Set(items.map(item => item.key)).size !== items.length) throw new JsonInputError("같은 키가 두 번 포함되어 있습니다.");
}

function parseChange(value: unknown): WikiItemChange {
  const { key, kind, text, evidence } = record(value);
  if (kind !== "current" && kind !== "example" && kind !== "discussion") {
    throw new JsonInputError("항목 종류는 current, example 또는 discussion이어야 합니다.");
  }
  return {
    key: requireKey(key), kind, text: requiredText(text, "내용", 2000).trim(),
    evidence: requiredText(evidence, "근거 문장", 2000),
  };
}

function parsePatch(value: unknown): WikiTopicPatch {
  const { key, title, expectedVersion, changes } = record(value);
  if (!Array.isArray(changes) || changes.length < 1 || changes.length > 30) {
    throw new JsonInputError("주제별 변경 항목은 1~30개여야 합니다.");
  }
  const parsed = changes.map(parseChange);
  uniqueKeys(parsed);
  return { key: requireKey(key), title: requiredText(title, "주제 제목", 160).trim(),
    expectedVersion: versionNumber(expectedVersion, 0, 2147483646), changes: parsed };
}

export async function readWikiInput(request: Request): Promise<WikiWriteInput> {
  const body = record(await readBoundedJson(request, 1024 * 1024, "LLM Wiki 요청은 1MiB까지 보낼 수 있습니다."));
  if (!Array.isArray(body.topics) || body.topics.length > 12) throw new JsonInputError("한 번에 최대 12개 주제를 보낼 수 있습니다.");
  const topics = body.topics.map(parsePatch);
  uniqueKeys(topics);
  const pageId = body.pageId;
  if (pageId !== undefined && (!validString(pageId, 255) || !pageId.trim())) throw new JsonInputError("근거 문서 ID를 확인하세요.");
  return { ...(typeof pageId === "string" && { pageId }), version: versionNumber(body.version, 1, 2147483647), topics };
}

export function wikiListOptions(params: URLSearchParams) {
  const q = (params.get("q") ?? "").trim().normalize("NFC");
  if (!validString(q, 160)) throw new JsonInputError("검색어는 160자 이하여야 합니다.");
  const sourceSlug = params.get("sourceSlug");
  if (sourceSlug !== null && (!validString(sourceSlug, 4096) || !sourceSlug.trim())) {
    throw new JsonInputError("근거 문서의 slug를 확인하세요.");
  }
  const offset = params.get("offset") ?? "0";
  const limit = params.get("limit") ?? "30";
  if (!/^\d{1,10}$/.test(offset) || Number(offset) > 2147483647 ||
      !/^\d{1,3}$/.test(limit) || Number(limit) < 1 || Number(limit) > 100) {
    throw new JsonInputError("offset은 0 이상, limit은 1~100 사이의 정수여야 합니다.");
  }
  return { q, ...(sourceSlug && { sourceSlug }), offset: Number(offset), limit: Number(limit) };
}
