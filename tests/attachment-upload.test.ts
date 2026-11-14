import { afterEach, expect, it, vi } from "vitest";
import { MAX_ATTACHMENT_BYTES, uploadAttachment } from "@/lib/attachment-upload";

const signal = new AbortController().signal;
const file = new File(["hello"], "note.txt");
afterEach(() => vi.unstubAllGlobals());

it.each([[401, "로그인"], [403, "권한"], [404, "접근"], [413, "용량"], [429, "요청"], [502, "502"]] as const)(
  "응답 본문을 읽을 수 없어도 HTTP %i의 원인을 설명한다", async (status, reason) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("proxy response", { status })));
    await expect(uploadAttachment("eng", file, signal)).rejects.toThrow(reason);
  },
);

it("20MB를 넘는 파일은 요청 전에 안내하고 정확히 20MB인 파일은 전송한다", async () => {
  const fetch = vi.fn().mockResolvedValue(Response.json({ url: "/api/attachments/test", filename: file.name }));
  vi.stubGlobal("fetch", fetch);
  const limit = new Uint8Array(MAX_ATTACHMENT_BYTES);
  await expect(uploadAttachment("eng", new File([limit, "x"], "large"), signal)).rejects.toThrow("20MB");
  expect(fetch).not.toHaveBeenCalled();
  await expect(uploadAttachment("eng", new File([limit], "allowed"), signal)).resolves.toHaveProperty("url");
  expect(fetch).toHaveBeenCalledTimes(1);
});
