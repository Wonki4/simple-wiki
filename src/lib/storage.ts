import { promises as fs } from "node:fs";
import path from "node:path";

export interface StorageAdapter {
  put(key: string, data: Buffer): Promise<void>;
  get(key: string): Promise<Buffer>;
}

const baseDir = () => process.env.ATTACHMENTS_DIR ?? "./data/attachments";

// key는 서버가 생성한 `${spaceId}/${uuid}` 형식만 사용 — 경로 조작 불가
export const storage: StorageAdapter = {
  async put(key, data) {
    const filePath = path.join(baseDir(), key);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, data);
  },
  async get(key) {
    return fs.readFile(path.join(baseDir(), key));
  },
};
