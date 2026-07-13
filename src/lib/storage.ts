import { promises as fs } from "node:fs";
import path from "node:path";

export interface StorageAdapter {
  put(key: string, data: Buffer): Promise<void>;
  get(key: string): Promise<Buffer>;
}

const baseDir = () => process.env.ATTACHMENTS_DIR ?? "./data/attachments";

// key는 서버가 생성한 `${spaceId}/${uuid}` 형식만 사용 — 경로 조작 불가
// 아래 resolveSafe는 방어적 이중 안전장치(defense in depth)로, 해석된 경로가
// baseDir 밖으로 벗어나면 예외를 던진다.
function resolveSafe(key: string): string {
  const base = path.resolve(baseDir());
  const filePath = path.resolve(base, key);
  if (!filePath.startsWith(base + path.sep)) {
    throw new Error("잘못된 스토리지 키입니다.");
  }
  return filePath;
}

export const storage: StorageAdapter = {
  async put(key, data) {
    const filePath = resolveSafe(key);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, data);
  },
  async get(key) {
    return fs.readFile(resolveSafe(key));
  },
};
