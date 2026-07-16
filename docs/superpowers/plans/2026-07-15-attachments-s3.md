# 첨부파일 오브젝트 스토리지 전환 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 첨부파일 저장을 로컬 디스크에서 사내 S3 호환 오브젝트 스토리지로 옮겨 k8s 앱 레플리카 수평 확장을 가능하게 하고, 스페이스 삭제 시 오브젝트를 정리한다.

**Architecture:** `src/lib/storage.ts`의 `StorageAdapter`를 3메서드(put / get→스트림 / deletePrefix)로 확장하고 local·s3 드라이버 2개를 같은 파일에 구현, `STORAGE_DRIVER` env로 선택한다. 다운로드는 앱 프록시 유지(권한·보안 헤더 불변). 스페이스 삭제 시 prefix 일괄 삭제(베스트에포트). helm은 driver=s3일 때 PVC를 생략해 replicaCount>1 제약을 푼다.

**Tech Stack:** Next.js 15 (App Router), `@aws-sdk/client-s3` (신규 의존성), vitest, Helm.

**Spec:** `docs/superpowers/specs/2026-07-15-attachments-object-storage-design.md`

## Global Constraints

- 작업 브랜치: `feat/attachments-s3` (이미 생성·체크아웃됨, 스펙 커밋 85879a8 포함. main 머지베이스 b65625f).
- dev PostgreSQL 호스트 포트 **5433** (docker `simple-wiki-postgres-1`, 이미 실행 중). DATABASE_URL은 `.env`에 있음.
- 타입체크는 `npx tsc --noEmit`. **`npm run build` 절대 금지** (라이브 dev 서버 .next 파손).
- 단위 테스트(vitest)는 외부 서비스 의존 금지 — local 어댑터는 tmp 디렉토리로 테스트, s3 어댑터는 스모크 스크립트(수동 실행)로.
- e2e 전체 실행은 깨끗한 DB 전제 → `prisma migrate reset`이 필요한데 **Prisma 6.19 AI 안전장치가 이를 차단**한다. reset은 컨트롤러가 사용자 동의를 받아 수행한다 — 서브에이전트는 reset을 직접 시도하지 말 것.
- 스토리지 키 형식 `${spaceId}/${uuid}` 유지. DB 스키마 변경 없음, 마이그레이션 없음.
- UI/에러 문구 한국어. 커밋: conventional prefix + 한국어 요약 + 마지막 줄 `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.

---

### Task 1: 스토리지 어댑터 개편 (local+s3 드라이버) + 다운로드 스트림화

**Files:**
- Modify: `package.json` (`@aws-sdk/client-s3` 의존성 추가 — `npm install`로)
- Modify: `src/lib/storage.ts` (전면 교체)
- Modify: `src/app/api/attachments/[id]/route.ts:20-35` (get 스트림 대응)
- Test: `tests/storage.test.ts` (신규)

**Interfaces:**
- Produces: `storage: StorageAdapter` (기존 export명 유지 — 업로드 라우트는 무변경), `StorageNotFoundError` (신규 export), `StorageAdapter.deletePrefix(prefix)` (Task 2가 사용).
- 주의: `storage.get`의 반환형이 `Buffer` → `ReadableStream<Uint8Array>`로 바뀐다. 호출처는 다운로드 라우트 한 곳뿐(이 태스크에서 함께 수정).

- [ ] **Step 1: 의존성 설치**

```bash
npm install @aws-sdk/client-s3
```

Expected: package.json dependencies에 추가, 에러 없음.

- [ ] **Step 2: 실패하는 테스트 작성**

`tests/storage.test.ts` 생성:

```ts
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
```

- [ ] **Step 3: 테스트 실패 확인**

```bash
npm test -- tests/storage.test.ts
```

Expected: FAIL — `StorageNotFoundError`/`deletePrefix` 미존재, get 반환형 불일치.

- [ ] **Step 4: storage.ts 전면 교체**

`src/lib/storage.ts` 전체를 다음으로 교체:

```ts
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
```

- [ ] **Step 5: 다운로드 라우트 스트림 대응**

`src/app/api/attachments/[id]/route.ts`에서 import에 `StorageNotFoundError` 추가:

```ts
import { storage, StorageNotFoundError } from "@/lib/storage";
```

`const data = await storage.get(att.storageKey);`부터 `return new Response(...)`까지를 다음으로 교체 (헤더 로직은 그대로):

```ts
  let body: ReadableStream<Uint8Array>;
  try {
    body = await storage.get(att.storageKey);
  } catch (e) {
    // 스토리지-DB 불일치(오브젝트 소실)도 존재 은닉과 같은 404로
    if (e instanceof StorageNotFoundError) return new Response("없습니다.", { status: 404 });
    throw e;
  }
  // SVG 등 스크립트 실행이 가능한 타입은 인라인 금지: 래스터 이미지만 허용목록으로 명시
  const baseMime = att.mime.split(";")[0].trim().toLowerCase();
  const inline = ["image/png", "image/jpeg", "image/gif", "image/webp"].includes(baseMime);
  return new Response(body, {
    headers: {
      "Content-Type": att.mime,
      "Content-Length": String(att.size),
      "Content-Disposition": `${inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(att.filename)}`,
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
      "Cache-Control": "private, no-cache",
    },
  });
```

- [ ] **Step 6: 테스트 통과 확인 + 전체 검증**

```bash
npm test -- tests/storage.test.ts
npm test && npx tsc --noEmit
```

Expected: storage 테스트 5개 PASS, 전체 단위 테스트 PASS(52개), 타입 에러 0.

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json src/lib/storage.ts "src/app/api/attachments/[id]/route.ts" tests/storage.test.ts
git commit -m "feat(storage): StorageAdapter를 스트림·deletePrefix로 확장하고 S3 드라이버 추가

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: 스페이스 삭제 시 스토리지 정리

**Files:**
- Modify: `src/actions/spaces.ts` (`deleteSpace`)

**Interfaces:**
- Consumes: Task 1의 `storage.deletePrefix(prefix)`.

- [ ] **Step 1: deleteSpace 교체**

`src/actions/spaces.ts`에 import 추가:

```ts
import { storage } from "@/lib/storage";
```

`deleteSpace` 전체를 다음으로 교체 (기존 v1 부채 주석 제거):

```ts
export async function deleteSpace(spaceKey: string) {
  const session = await requireSession();
  if (!session.isWikiAdmin) redirect("/denied");
  const space = await prisma.space.findUnique({ where: { key: spaceKey } });
  if (!space) redirect("/");
  // Page/PageRevision/PageLink/SpacePermission/Attachment 레코드는 onDelete: Cascade로 함께 삭제된다.
  await prisma.space.delete({ where: { id: space.id } });
  // 스토리지 오브젝트 정리는 베스트에포트 — 실패해도 스페이스 삭제는 유지한다.
  // 고아 오브젝트는 무해(키 유일·재사용 없음)하지만 반쯤 롤백된 삭제가 더 나쁘다.
  try {
    await storage.deletePrefix(space.id);
  } catch (e) {
    console.error(`[storage] 스페이스 ${spaceKey}(${space.id}) 첨부 정리 실패:`, e);
  }
  revalidatePath("/");
  redirect("/");
}
```

- [ ] **Step 2: 검증**

```bash
npm test && npx tsc --noEmit
```

Expected: 전부 PASS, 타입 에러 0. (동작 검증은 Task 5의 e2e "wiki-admin" 시나리오가 스페이스 삭제 경로를 지나지 않으므로, dev 수동 스모크에서 확인 — Task 5 Step 4.)

- [ ] **Step 3: Commit**

```bash
git add src/actions/spaces.ts
git commit -m "feat(spaces): 스페이스 삭제 시 첨부 오브젝트 prefix 일괄 정리 (베스트에포트)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: S3 스모크 스크립트

**Files:**
- Create: `scripts/storage-smoke.ts`

**Interfaces:**
- Consumes: Task 1의 `storage`, `StorageNotFoundError` (상대 경로 import — storage.ts는 `@/` alias를 쓰지 않아 tsx로 바로 실행 가능).

- [ ] **Step 1: 스크립트 작성**

`scripts/storage-smoke.ts` 생성:

```ts
// S3 어댑터 스모크 테스트 — 실제 버킷(또는 MinIO)에 put→get→deletePrefix 라운드트립.
// 운영 배포 전 수동 실행. 로컬 드라이버는 tests/storage.test.ts로 검증되므로 대상 아님.
//
// 사용:
//   STORAGE_DRIVER=s3 S3_ENDPOINT=https://... S3_BUCKET=simple-wiki \
//   S3_ACCESS_KEY_ID=... S3_SECRET_ACCESS_KEY=... npx tsx scripts/storage-smoke.ts
import { storage, StorageNotFoundError } from "../src/lib/storage";

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
```

- [ ] **Step 2: 로컬 가드 동작 확인 + 타입체크**

```bash
npx tsx scripts/storage-smoke.ts; echo "exit=$?"
npx tsc --noEmit
```

Expected: "STORAGE_DRIVER=s3로 실행하세요..." 출력 후 exit=1. tsc 에러 0. (실 버킷 라운드트립은 운영 자격증명 확보 후 사용자/운영자가 수동 실행.)

- [ ] **Step 3: Commit**

```bash
git add scripts/storage-smoke.ts
git commit -m "test(storage): S3 어댑터 스모크 스크립트 추가

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: 배포 구성 (helm / compose / env 예시)

**Files:**
- Modify: `deploy/helm/simple-wiki/values.yaml`
- Modify: `deploy/helm/simple-wiki/templates/_helpers.tpl` (`simple-wiki.appEnv`)
- Modify: `deploy/helm/simple-wiki/templates/secret.yaml`
- Modify: `deploy/helm/simple-wiki/templates/deployment.yaml:61-99` (PVC 조건)
- Modify: `deploy/helm/simple-wiki/templates/pvc.yaml` (게이트 조건)
- Modify: `docker-compose.prod.yml` (app environment)
- Modify: `.env.example`, `.env.prod.example`

**Interfaces:**
- Consumes: Task 1의 env 계약 — `STORAGE_DRIVER`, `S3_ENDPOINT`, `S3_BUCKET`, `S3_REGION`, `S3_FORCE_PATH_STYLE`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`.

- [ ] **Step 1: values.yaml**

`config:` 블록 아래(persistence 위)에 추가:

```yaml
# 첨부 저장 드라이버. local=PVC 디스크(기본), s3=사내 S3 호환 오브젝트 스토리지.
# s3를 쓰면 PVC가 필요 없어져 app.replicaCount>1 수평 확장이 가능해진다.
# 자격증명(S3_ACCESS_KEY_ID/S3_SECRET_ACCESS_KEY)은 secrets 쪽에서 설정한다.
storage:
  driver: local
  s3:
    endpoint: ""            # 예: https://s3.corp.example.com
    bucket: ""
    region: us-east-1       # 호환 스토리지 관례 기본값
    forcePathStyle: true
```

`secrets:` 블록의 `keycloakSecret: ""` 다음 줄에 추가:

```yaml
  # storage.driver=s3일 때만 필수
  s3AccessKeyId: ""
  s3SecretAccessKey: ""
```

`secrets.keys:`에 추가:

```yaml
    s3AccessKeyId: S3_ACCESS_KEY_ID
    s3SecretAccessKey: S3_SECRET_ACCESS_KEY
```

persistence 주석(78행) 교체:

```yaml
# 첨부파일 디스크 저장 — storage.driver=local일 때만 사용된다.
# local + replicaCount>1 이면 accessMode를 ReadWriteMany로. (s3 드라이버면 PVC 자체가 생성되지 않음)
```

- [ ] **Step 2: _helpers.tpl — appEnv에 스토리지 env 추가**

`ATTACHMENTS_DIR` env 항목(85-86행) 바로 뒤에 추가:

```yaml
- name: STORAGE_DRIVER
  value: {{ .Values.storage.driver | quote }}
{{- if eq .Values.storage.driver "s3" }}
- name: S3_ENDPOINT
  value: {{ required "storage.s3.endpoint is required when storage.driver=s3" .Values.storage.s3.endpoint | quote }}
- name: S3_BUCKET
  value: {{ required "storage.s3.bucket is required when storage.driver=s3" .Values.storage.s3.bucket | quote }}
- name: S3_REGION
  value: {{ .Values.storage.s3.region | quote }}
- name: S3_FORCE_PATH_STYLE
  value: {{ .Values.storage.s3.forcePathStyle | quote }}
- name: S3_ACCESS_KEY_ID
  valueFrom:
    secretKeyRef:
      name: {{ include "simple-wiki.secretName" . }}
      key: {{ .Values.secrets.keys.s3AccessKeyId }}
- name: S3_SECRET_ACCESS_KEY
  valueFrom:
    secretKeyRef:
      name: {{ include "simple-wiki.secretName" . }}
      key: {{ .Values.secrets.keys.s3SecretAccessKey }}
{{- end }}
```

- [ ] **Step 3: secret.yaml — s3 키 조건부 추가**

`{{ .Values.secrets.keys.keycloakSecret }}` 줄 다음에 추가:

```yaml
  {{- if eq .Values.storage.driver "s3" }}
  {{ .Values.secrets.keys.s3AccessKeyId }}: {{ required "secrets.s3AccessKeyId is required when storage.driver=s3" .Values.secrets.s3AccessKeyId | quote }}
  {{ .Values.secrets.keys.s3SecretAccessKey }}: {{ required "secrets.s3SecretAccessKey is required when storage.driver=s3" .Values.secrets.s3SecretAccessKey | quote }}
  {{- end }}
```

- [ ] **Step 4: deployment.yaml / pvc.yaml — PVC를 local 드라이버 전용으로**

`deployment.yaml`에서 attachments 볼륨 관련 조건 3곳을 교체한다. 61행:

```yaml
          {{- if or (and .Values.persistence.enabled (eq .Values.storage.driver "local")) .Values.config.keycloakCA }}
```

63행 (volumeMounts 안):

```yaml
            {{- if and .Values.persistence.enabled (eq .Values.storage.driver "local") }}
```

87행 (volumes 게이트) / 89행 (attachments 볼륨)도 같은 패턴으로:

```yaml
      {{- if or (and .Values.persistence.enabled (eq .Values.storage.driver "local")) .Values.config.keycloakCA }}
```

```yaml
        {{- if and .Values.persistence.enabled (eq .Values.storage.driver "local") }}
```

`pvc.yaml`의 첫 줄 게이트를 교체:

```yaml
{{- if and .Values.persistence.enabled (eq .Values.storage.driver "local") }}
```

- [ ] **Step 5: docker-compose.prod.yml — app environment에 추가**

`ATTACHMENTS_DIR: /data/attachments` 줄 다음에:

```yaml
      # 첨부 저장 드라이버 — s3면 아래 S3_* 를 채운다 (volumes의 attachments는 local일 때만 쓰임)
      STORAGE_DRIVER: ${STORAGE_DRIVER:-local}
      S3_ENDPOINT: ${S3_ENDPOINT:-}
      S3_BUCKET: ${S3_BUCKET:-}
      S3_REGION: ${S3_REGION:-us-east-1}
      S3_FORCE_PATH_STYLE: ${S3_FORCE_PATH_STYLE:-true}
      S3_ACCESS_KEY_ID: ${S3_ACCESS_KEY_ID:-}
      S3_SECRET_ACCESS_KEY: ${S3_SECRET_ACCESS_KEY:-}
```

- [ ] **Step 6: env 예시 파일**

`.env.example`의 `ATTACHMENTS_DIR=./data/attachments` 아래에 추가:

```
# 첨부 저장 드라이버: local(기본) | s3. s3면 아래 S3_* 필수 (S3_REGION/S3_FORCE_PATH_STYLE는 기본값 있음)
# STORAGE_DRIVER=s3
# S3_ENDPOINT=https://s3.corp.example.com
# S3_BUCKET=simple-wiki
# S3_ACCESS_KEY_ID=...
# S3_SECRET_ACCESS_KEY=...
# S3_REGION=us-east-1
# S3_FORCE_PATH_STYLE=true
```

`.env.prod.example` 맨 아래에 같은 블록을 추가하되 첫 줄 주석을 `# 운영 권장: STORAGE_DRIVER=s3 (PVC 없이 레플리카 확장 가능)`로.

- [ ] **Step 7: helm template 렌더 검증 (양쪽 드라이버)**

```bash
helm template deploy/helm/simple-wiki \
  --set secrets.authSecret=x --set secrets.databaseUrl=x --set secrets.keycloakSecret=x \
  | grep -E "STORAGE_DRIVER|persistentVolumeClaim|kind: PersistentVolumeClaim" 
helm template deploy/helm/simple-wiki \
  --set secrets.authSecret=x --set secrets.databaseUrl=x --set secrets.keycloakSecret=x \
  --set storage.driver=s3 --set storage.s3.endpoint=https://s3.example.com --set storage.s3.bucket=wiki \
  --set secrets.s3AccessKeyId=k --set secrets.s3SecretAccessKey=s \
  | grep -E "STORAGE_DRIVER|S3_|persistentVolumeClaim|kind: PersistentVolumeClaim"
```

Expected: local 렌더에는 PVC/volumeMount 존재 + `STORAGE_DRIVER: "local"`. s3 렌더에는 `S3_*` env가 있고 **PersistentVolumeClaim이 렌더되지 않음**. s3에서 endpoint/bucket/자격증명을 빼면 `required` 에러로 실패하는 것도 한 번 확인.

- [ ] **Step 8: Commit**

```bash
git add deploy/helm/simple-wiki docker-compose.prod.yml .env.example .env.prod.example
git commit -m "feat(deploy): STORAGE_DRIVER=s3 지원 — s3면 PVC 생략, 레플리카 확장 가능

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: 전체 검증 + PR

**Files:** 없음 (검증만)

- [ ] **Step 1: 단위 + 타입**

```bash
npm test && npx tsc --noEmit
```

Expected: 전부 PASS (기존 47 + storage 5 = 52), 타입 에러 0.

- [ ] **Step 2: e2e 준비 — DB 리셋 (컨트롤러 담당)**

e2e는 깨끗한 DB 전제. **`prisma migrate reset`은 Prisma AI 안전장치로 서브에이전트가 실행 불가** — 컨트롤러가 사용자 동의를 받아 리셋 + `npm run db:seed` 수행 후 이 태스크를 재개한다.

- [ ] **Step 3: e2e 전체 실행**

```bash
npm run e2e
```

Expected: 11/11 PASS — 특히 "첨부파일: 권한/SVG 차단" 테스트가 local 드라이버 스트림 경로로 통과해야 한다(어댑터 개편이 권한·보안 경로에 영향 없음을 증명).

- [ ] **Step 4: 수동 스모크 — 스페이스 삭제 정리 (dev, local 드라이버)**

```bash
# dev 서버가 떠 있는 상태(e2e가 띄운 것 재사용 가능)에서:
# 1) e2e가 만든 첨부가 있는 스페이스 확인
ls data/attachments/
# 2) wiki-admin으로 로그인해 e2e-docs 스페이스 삭제 (또는 첨부 있는 스페이스)
# 3) 해당 spaceId 디렉토리가 사라졌는지 확인
ls data/attachments/
```

Expected: 삭제한 스페이스의 spaceId 디렉토리가 없어짐. (UI 조작이 어려우면 psql로 spaceId 확인 후 curl 대신 — 어느 쪽이든 디렉토리 소멸을 확인하고 결과를 리포트에 남긴다.)

- [ ] **Step 5: PR 생성**

```bash
git push -u origin feat/attachments-s3
gh pr create --title "feat: 첨부파일 오브젝트 스토리지(S3 호환) 지원" --body "$(cat <<'EOF'
## Summary
- StorageAdapter를 put/get(스트림)/deletePrefix 3메서드로 확장, local·s3 드라이버 구현 (`STORAGE_DRIVER`로 선택)
- 다운로드는 앱 프록시 유지 — 권한 검사·SVG 차단·CSP 등 보안 경로 불변, 20MB 버퍼링 제거(스트리밍)
- 스페이스 삭제 시 첨부 오브젝트 prefix 일괄 정리 (베스트에포트, v1 부채 해소)
- helm: storage.driver=s3면 PVC 생략 → app.replicaCount>1 수평 확장 가능
- S3 스모크 스크립트(`scripts/storage-smoke.ts`) — 운영 자격증명으로 배포 전 수동 검증

설계 문서: docs/superpowers/specs/2026-07-15-attachments-object-storage-design.md

## 배포 노트
- 코드 변경만으로는 동작 불변(기본 local). 운영 전환 시 helm values에 storage.driver=s3 + 엔드포인트/버킷/자격증명 설정.
- 전환 전 `scripts/storage-smoke.ts`로 버킷 라운드트립 확인 권장. 기존 첨부 데이터 마이그레이션 없음(합의됨).

## Test plan
- [x] unit 52/52 (storage 어댑터 계약 5건 포함) / tsc 0
- [x] e2e 11/11 — 첨부 권한/SVG 차단 시나리오 포함
- [x] helm template 양쪽 드라이버 렌더 검증 (s3면 PVC 미생성)
- [x] 스페이스 삭제 → 첨부 디렉토리 정리 수동 확인

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Self-Review 결과

- **스펙 커버리지:** 어댑터 인터페이스·드라이버 2종·env 계약(Task 1), 다운로드 스트림+404 매핑(Task 1 Step 5), 스페이스 삭제 베스트에포트+findUnique 전환(Task 2), 스모크 스크립트(Task 3), helm 조건부 PVC·secret·compose·env 예시(Task 4), e2e 회귀 증명(Task 5). 마이그레이션 없음(스펙 합의) — 커버 완료.
- **타입 일관성:** `StorageAdapter`/`StorageNotFoundError`/`storage` export명이 Task 1 정의 그대로 Task 2·3에서 소비됨. env 이름이 Task 1 코드 ↔ Task 4 배포 구성에서 동일함을 대조 확인.
- **placeholder 스캔:** TBD/TODO 없음. 모든 코드 스텝에 실제 코드 포함.
- **의도적 결정:** s3 어댑터의 실 버킷 검증은 vitest가 아닌 수동 스모크(외부 의존 금지 컨벤션). Task 5 Step 2는 컨트롤러 개입 지점으로 명시(Prisma AI 안전장치).
