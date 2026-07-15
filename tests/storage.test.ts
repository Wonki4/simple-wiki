import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { storage, StorageNotFoundError } from "@/lib/storage";

// STORAGE_DRIVER 미설정 → local 드라이버. ATTACHMENTS_DIR는 호출 시점에 읽히므로
// beforeAll에서 tmp 디렉토리로 바꾸면 이후 모든 연산이 거기서 일어난다.
let dir: string;
beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "wiki-storage-"));
  process.env.ATTACHMENTS_DIR = dir;
});
afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function readAll(stream: ReadableStream<Uint8Array>): Promise<Buffer> {
  const chunks: Uint8Array[] = [];
  const reader = stream.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}

describe("local 스토리지 어댑터", () => {
  it("put → get 라운드트립", async () => {
    await storage.put("space1/file1", Buffer.from("hello"));
    const buf = await readAll(await storage.get("space1/file1"));
    expect(buf.toString()).toBe("hello");
  });

  it("없는 키는 StorageNotFoundError", async () => {
    await expect(storage.get("space1/nope")).rejects.toBeInstanceOf(StorageNotFoundError);
  });

  it("deletePrefix는 프리픽스 아래만 지운다", async () => {
    await storage.put("space2/a", Buffer.from("a"));
    await storage.put("space2/b", Buffer.from("b"));
    await storage.put("space3/c", Buffer.from("c"));
    await storage.deletePrefix("space2");
    await expect(storage.get("space2/a")).rejects.toBeInstanceOf(StorageNotFoundError);
    await expect(storage.get("space2/b")).rejects.toBeInstanceOf(StorageNotFoundError);
    expect((await readAll(await storage.get("space3/c"))).toString()).toBe("c");
  });

  it("deletePrefix는 대상이 없어도 성공", async () => {
    await expect(storage.deletePrefix("no-such-space")).resolves.toBeUndefined();
  });

  it("경로 탈출 키는 거부", async () => {
    await expect(storage.get("../evil")).rejects.toThrow("잘못된 스토리지 키");
  });
});
