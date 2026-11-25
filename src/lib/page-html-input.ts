import { JsonInputError as PageHtmlInputError, readBoundedJson } from "./bounded-json";

export { PageHtmlInputError };
export const MAX_PAGE_HTML_BYTES = 512 * 1024;
// An ASCII character may occupy six bytes when JSON escapes it as \uXXXX.
const MAX_JSON_BYTES = 6 * MAX_PAGE_HTML_BYTES + 1024;

const sizeMessage = "HTML은 UTF-8 기준 512 KiB까지 저장할 수 있습니다.";

export async function readPageHtmlInput(request: Request): Promise<{ html: string; baseVersion: number }> {
  const body = await readBoundedJson(request, MAX_JSON_BYTES, sizeMessage);
  if (!body || typeof body !== "object") throw new PageHtmlInputError("JSON 객체가 필요합니다.");
  const { html, baseVersion } = body as Record<string, unknown>;
  if (typeof baseVersion !== "number" || !Number.isSafeInteger(baseVersion) || baseVersion < 1) {
    throw new PageHtmlInputError("원문에서 읽은 baseVersion(양의 정수)이 필요합니다.");
  }
  if (typeof html !== "string" || !html.trim()) throw new PageHtmlInputError("html 문자열이 필요합니다.");
  if (Buffer.byteLength(html, "utf8") > MAX_PAGE_HTML_BYTES) throw new PageHtmlInputError(sizeMessage, 413);
  if (html.includes("\0") || !html.isWellFormed()) throw new PageHtmlInputError("HTML에 저장할 수 없는 문자가 있습니다.");
  return { html, baseVersion };
}
