// S3 어댑터 스모크 테스트 — 실제 버킷(또는 MinIO)에 put→get→deletePrefix 라운드트립.
// 운영 배포 전 수동 실행. 로컬 드라이버는 tests/storage.test.ts로 검증되므로 대상 아님.
//
// 사용:
//   STORAGE_DRIVER=s3 S3_ENDPOINT=https://... S3_BUCKET=simple-wiki \
//   S3_ACCESS_KEY_ID=... S3_SECRET_ACCESS_KEY=... npx tsx scripts/storage-smoke.ts
import { storage, StorageNotFoundError } from "../src/lib/storage";

(async () => {
  if ((process.env.STORAGE_DRIVER ?? "local") !== "s3") {
    console.error("STORAGE_DRIVER=s3로 실행하세요. (local 드라이버는 단위 테스트로 검증됩니다)");
    process.exit(1);
  }

  const prefix = `smoke-${Date.now()}`;
  const key = `${prefix}/hello.txt`;
  const payload = Buffer.from(`storage smoke ${new Date().toISOString()}`);

  await storage.put(key, payload);
  console.log("PUT ok:", key);

  const chunks: Uint8Array[] = [];
  const reader = (await storage.get(key)).getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }
  const roundtrip = Buffer.concat(chunks);
  if (!roundtrip.equals(payload)) throw new Error("GET 내용이 PUT과 다릅니다");
  console.log("GET ok:", roundtrip.length, "bytes");

  await storage.deletePrefix(prefix);
  let deleted = false;
  try {
    await storage.get(key);
  } catch (e) {
    if (e instanceof StorageNotFoundError) deleted = true;
    else throw e;
  }
  if (!deleted) throw new Error("deletePrefix 후에도 GET이 성공 — 삭제 실패");
  console.log("DELETE ok");
  console.log("=== storage smoke 통과 ===");
})();
