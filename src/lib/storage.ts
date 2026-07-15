import { promises as fs, createReadStream } from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  DeleteObjectsCommand,
} from "@aws-sdk/client-s3";

export interface StorageAdapter {
  put(key: string, data: Buffer): Promise<void>;
  /** 반환 스트림은 Response body로 그대로 전달한다. 오브젝트가 없으면 StorageNotFoundError. */
  get(key: string): Promise<ReadableStream<Uint8Array>>;
  /** prefix(= spaceId) 아래 모든 오브젝트 삭제. 대상이 없어도 성공한다. */
  deletePrefix(prefix: string): Promise<void>;
}

export class StorageNotFoundError extends Error {
  constructor(key: string) {
    super(`스토리지에 없는 키입니다: ${key}`);
    this.name = "StorageNotFoundError";
  }
}

const baseDir = () => process.env.ATTACHMENTS_DIR ?? "./data/attachments";

// key는 서버가 생성한 `${spaceId}/${uuid}` 형식만 사용 — 경로 조작 불가
// 아래 resolveSafe는 방어적 이중 안전장치(defense in depth)로, 해석된 경로가
// baseDir 밖으로 벗어나면 예외를 던진다. deletePrefix의 prefix에도 동일 적용.
function resolveSafe(key: string): string {
  const base = path.resolve(baseDir());
  const filePath = path.resolve(base, key);
  if (!filePath.startsWith(base + path.sep)) {
    throw new Error("잘못된 스토리지 키입니다.");
  }
  return filePath;
}

const localAdapter: StorageAdapter = {
  async put(key, data) {
    const filePath = resolveSafe(key);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, data);
  },
  async get(key) {
    const filePath = resolveSafe(key);
    try {
      await fs.stat(filePath);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") throw new StorageNotFoundError(key);
      throw e;
    }
    return Readable.toWeb(createReadStream(filePath)) as unknown as ReadableStream<Uint8Array>;
  },
  async deletePrefix(prefix) {
    await fs.rm(resolveSafe(prefix), { recursive: true, force: true });
  },
};

function createS3Adapter(): StorageAdapter {
  const required = ["S3_ENDPOINT", "S3_BUCKET", "S3_ACCESS_KEY_ID", "S3_SECRET_ACCESS_KEY"] as const;
  const missing = required.filter((k) => !process.env[k]);
  if (missing.length > 0) {
    throw new Error(`STORAGE_DRIVER=s3인데 필수 환경변수가 없습니다: ${missing.join(", ")}`);
  }
  const bucket = process.env.S3_BUCKET!;
  const client = new S3Client({
    endpoint: process.env.S3_ENDPOINT,
    region: process.env.S3_REGION ?? "us-east-1",
    // 사내 S3 호환 스토리지는 대부분 path-style — 기본 켬
    forcePathStyle: (process.env.S3_FORCE_PATH_STYLE ?? "true") !== "false",
    credentials: {
      accessKeyId: process.env.S3_ACCESS_KEY_ID!,
      secretAccessKey: process.env.S3_SECRET_ACCESS_KEY!,
    },
  });
  return {
    async put(key, data) {
      await client.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: data }));
    },
    async get(key) {
      try {
        const r = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
        return r.Body!.transformToWebStream() as unknown as ReadableStream<Uint8Array>;
      } catch (e) {
        if ((e as { name?: string }).name === "NoSuchKey") throw new StorageNotFoundError(key);
        throw e;
      }
    },
    async deletePrefix(prefix) {
      let token: string | undefined;
      do {
        const page = await client.send(
          new ListObjectsV2Command({ Bucket: bucket, Prefix: `${prefix}/`, ContinuationToken: token }),
        );
        const objects = (page.Contents ?? []).flatMap((o) => (o.Key ? [{ Key: o.Key }] : []));
        if (objects.length > 0) {
          await client.send(new DeleteObjectsCommand({ Bucket: bucket, Delete: { Objects: objects } }));
        }
        token = page.IsTruncated ? page.NextContinuationToken : undefined;
      } while (token);
    },
  };
}

// 드라이버 선택은 기동(모듈 로드) 시점 1회 — s3 설정 누락은 여기서 즉시 실패한다.
export const storage: StorageAdapter =
  (process.env.STORAGE_DRIVER ?? "local") === "s3" ? createS3Adapter() : localAdapter;
