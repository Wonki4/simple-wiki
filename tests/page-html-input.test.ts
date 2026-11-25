import { describe, expect, it } from "vitest";
import { MAX_PAGE_HTML_BYTES, readPageHtmlInput } from "@/lib/page-html-input";

function jsonRequest(body: unknown) {
  return new Request("http://wiki.test/api", { method: "PUT", body: JSON.stringify(body) });
}

describe("HTML 미리보기 저장 입력", () => {
  it("JSON 이스케이프를 풀어 HTML을 공백까지 그대로 보존한다", async () => {
    // Quotes expand to two bytes on the wire, but count once in the saved document.
    const html = " " + '"'.repeat(MAX_PAGE_HTML_BYTES - 2) + "\n";
    await expect(readPageHtmlInput(jsonRequest({ html, baseVersion: 1 }))).resolves.toEqual({ html, baseVersion: 1 });
  });

  it("한글이 포함된 HTML의 크기는 UTF-8 바이트 단위로 제한한다", async () => {
    const html = "가".repeat(Math.floor(MAX_PAGE_HTML_BYTES / 3)) + "ab";
    expect(Buffer.byteLength(html)).toBe(MAX_PAGE_HTML_BYTES);
    await expect(readPageHtmlInput(jsonRequest({ html, baseVersion: 2 }))).resolves.toEqual({ html, baseVersion: 2 });
    await expect(readPageHtmlInput(jsonRequest({ html: html + "x", baseVersion: 2 }))).rejects.toMatchObject({ status: 413 });
  });

  it.each([{}, null, [], { html: "text" }, { html: "text", baseVersion: 0 }, { html: "text", baseVersion: 2.1 },
    { html: "text", baseVersion: "1" }, { html: {}, baseVersion: 1 }, { html: " \n ", baseVersion: 1 },
    { html: "n\0l", baseVersion: 1 }, { html: "\ud800", baseVersion: 1 }])(
    "잘못된 HTML·원문 버전은 400으로 반환한다", async body => {
      await expect(readPageHtmlInput(jsonRequest(body))).rejects.toMatchObject({ status: 400 });
    },
  );

  it("길이 헤더가 없는 과대한 스트림을 끝까지 읽기 전에 취소한다", async () => {
    let cancelled = false;
    const chunk = new Uint8Array(64 * 1024).fill(32);
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) { controller.enqueue(chunk); },
      cancel() { cancelled = true; },
    });
    const request = new Request("http://wiki.test/api", { method: "PUT", body: stream, duplex: "half" } as RequestInit);
    await expect(readPageHtmlInput(request)).rejects.toMatchObject({ status: 413 });
    expect(cancelled).toBe(true);
  });
});
