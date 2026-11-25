export class JsonInputError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
  }
}

export async function readBoundedJson(request: Request, limit: number, overflowMessage: string): Promise<unknown> {
  if (Number(request.headers.get("content-length")) > limit) throw new JsonInputError(overflowMessage, 413);
  if (!request.body) throw new JsonInputError("JSON 본문이 필요합니다.");
  const reader = request.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let bytesRead = 0;
  let text = "";
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      bytesRead += value.byteLength;
      if (bytesRead > limit) {
        void reader.cancel().catch(() => {});
        throw new JsonInputError(overflowMessage, 413);
      }
      text += decoder.decode(value, { stream: true });
    }
    return JSON.parse(text + decoder.decode());
  } catch (error) {
    if (error instanceof JsonInputError) throw error;
    throw new JsonInputError("UTF-8 JSON 본문이 올바르지 않습니다.");
  } finally {
    reader.releaseLock();
  }
}
