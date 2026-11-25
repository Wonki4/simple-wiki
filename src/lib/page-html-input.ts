export const MAX_PAGE_HTML_BYTES = 512 * 1024;
// An ASCII character may occupy six bytes when JSON escapes it as \uXXXX.
const MAX_JSON_BYTES = 6 * MAX_PAGE_HTML_BYTES + 1024;

export class PageHtmlInputError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
  }
}

function tooLarge() {
  return new PageHtmlInputError("HTML은 UTF-8 기준 512 KiB까지 저장할 수 있습니다.", 413);
}

async function readBoundedJson(request: Request): Promise<unknown> {
  if (Number(request.headers.get("content-length")) > MAX_JSON_BYTES) throw tooLarge();
  if (!request.body) throw new PageHtmlInputError("JSON 본문이 필요합니다.");
  const reader = request.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let bytesRead = 0;
  let text = "";
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      bytesRead += value.byteLength;
      if (bytesRead > MAX_JSON_BYTES) {
        void reader.cancel().catch(() => {});
        throw tooLarge();
      }
      text += decoder.decode(value, { stream: true });
    }
    return JSON.parse(text + decoder.decode());
  } catch (error) {
    if (error instanceof PageHtmlInputError) throw error;
    throw new PageHtmlInputError("UTF-8 JSON 본문이 올바르지 않습니다.");
  } finally {
    reader.releaseLock();
  }
}

export async function readPageHtmlInput(request: Request): Promise<{ html: string; baseVersion: number }> {
  const body = await readBoundedJson(request);
  if (!body || typeof body !== "object") throw new PageHtmlInputError("JSON 객체가 필요합니다.");
  const { html, baseVersion } = body as Record<string, unknown>;
  if (typeof baseVersion !== "number" || !Number.isSafeInteger(baseVersion) || baseVersion < 1) {
    throw new PageHtmlInputError("원문에서 읽은 baseVersion(양의 정수)이 필요합니다.");
  }
  if (typeof html !== "string" || !html.trim()) throw new PageHtmlInputError("html 문자열이 필요합니다.");
  if (Buffer.byteLength(html, "utf8") > MAX_PAGE_HTML_BYTES) throw tooLarge();
  if (html.includes("\0") || !html.isWellFormed()) throw new PageHtmlInputError("HTML에 저장할 수 없는 문자가 있습니다.");
  return { html, baseVersion };
}
