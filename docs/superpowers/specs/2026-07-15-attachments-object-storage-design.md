# 첨부파일 오브젝트 스토리지 전환 설계

**작성일:** 2026-07-15
**목표:** 첨부파일(본문 이미지 포함) 저장을 로컬 디스크에서 사내 S3 호환 오브젝트 스토리지로 옮겨, k8s에서 앱 레플리카 수평 확장(PVC ReadWriteOnce 제약)을 풀고 스페이스 삭제 시 파일 잔재 부채를 정리한다.

## 배경 / 문제

첨부는 현재 `src/lib/storage.ts`의 로컬 FS 구현(`ATTACHMENTS_DIR`, 기본 `./data/attachments`)에 저장된다.

1. **수평 확장 불가** — helm 차트가 PVC `ReadWriteOnce`를 마운트하므로 `replicaCount > 1`이면 노드 간 볼륨 공유가 안 된다 (values.yaml:78 주석으로 남긴 기존 부채).
2. **삭제 잔재** — 스페이스를 삭제해도 디스크 파일이 영원히 남는다 (`src/actions/spaces.ts`의 v1 허용 주석).
3. 업로드/다운로드 경로 자체는 건전하다: 업로드는 editor 권한 + 20MB 제한, 다운로드는 `/api/attachments/[id]`가 요청마다 권한 검사 후 스트리밍하며 SVG 인라인 차단·CSP sandbox 등 보안 헤더를 앱이 통제한다.

## 결정 사항 (사용자 확인)

- **사내 S3 호환 오브젝트 스토리지 사용** (엔드포인트 발급 가능).
- **기존 데이터 마이그레이션 불필요** — 운영 첨부가 거의 없어 새출발.
- **다운로드는 앱 프록시 유지** (A안) — 권한 모델·URL·보안 헤더 불변. presigned URL 리다이렉트(B안)는 URL 유출 시 만료 전 무권한 접근, 브라우저→스토리지 직접 접근 필요(네트워크 정책), 헤더 통제 상실 때문에 배제. 20MB 제한과 사내 트래픽 규모에서 프록시 대역폭 부담은 무의미.
- **삭제 정리는 스페이스 삭제 시 prefix 일괄 삭제만** — 고아 첨부 GC(본문 미참조 정리)는 범위 외.

## 스토리지 어댑터 (`src/lib/storage.ts`)

인터페이스를 확장하고 구현을 드라이버 2개로 나눈다:

```ts
export interface StorageAdapter {
  put(key: string, data: Buffer): Promise<void>;
  /** 반환 스트림은 Response body로 그대로 전달 가능해야 한다 */
  get(key: string): Promise<ReadableStream<Uint8Array>>;
  /** prefix(= spaceId) 아래 모든 오브젝트 삭제. 대상이 없어도 성공 */
  deletePrefix(prefix: string): Promise<void>;
}
```

- `get`을 Buffer → **웹 스트림** 반환으로 변경: S3 응답을 그대로 흘려 20MB 메모리 버퍼링을 없앤다. 로컬 구현은 `fs.createReadStream` + `Readable.toWeb`. 다운로드 라우트는 `new Response(stream, ...)`으로 변경되고 보안 헤더 로직은 그대로. `Content-Length`는 DB의 `Attachment.size`로 채운다.
- **local 드라이버** (기존): dev/e2e 기본. `deletePrefix`는 `fs.rm(dir, { recursive: true, force: true })`. 기존 `resolveSafe` 경로 방어 유지(prefix에도 적용).
- **s3 드라이버** (신규): `@aws-sdk/client-s3`. `PutObject`/`GetObject`/`ListObjectsV2`+`DeleteObjects`(1000개 단위 페이지네이션 루프).
- **드라이버 선택**: `STORAGE_DRIVER` env — `local`(기본) | `s3`. s3 선택 시 필수 env가 없으면 기동 시점에 명확한 에러.

| env | 설명 |
|---|---|
| `STORAGE_DRIVER` | `local`(기본) 또는 `s3` |
| `S3_ENDPOINT` | 사내 스토리지 엔드포인트 URL |
| `S3_BUCKET` | 버킷 이름 |
| `S3_ACCESS_KEY_ID` / `S3_SECRET_ACCESS_KEY` | 자격증명 |
| `S3_REGION` | 기본 `us-east-1` (호환 스토리지 관례) |
| `S3_FORCE_PATH_STYLE` | 기본 `true` (사내 호환 스토리지 대부분 path-style) |

스토리지 키는 기존 `${spaceId}/${uuid}` 구조 유지 — prefix 삭제와 자연 정합하고, DB `Attachment.storageKey`도 그대로라 스키마 변경이 없다.

## 라우트 변경

- **업로드** `POST /api/spaces/[spaceKey]/attachments`: `storage.put` 호출부 불변 (Buffer 그대로).
- **다운로드** `GET /api/attachments/[id]`: `storage.get`이 스트림을 반환하므로 `new Response(stream, { headers })`로 교체. 인라인 허용목록(래스터 이미지만)·`X-Content-Type-Options`·CSP sandbox·`Content-Disposition` 로직 전부 불변. 오브젝트가 없으면(스토리지-DB 불일치) 404.

## 스페이스 삭제 정리 (`src/actions/spaces.ts` deleteSpace)

- DB에서 스페이스 삭제 성공 **후** `storage.deletePrefix(space.id)`를 **베스트에포트**로 호출: 실패해도 스페이스 삭제는 유지하고 `console.error` 로그만 남긴다. 근거 — 고아 오브젝트는 무해(키가 유일하고 재사용 없음)하지만, 정리 실패로 삭제가 반쯤 롤백되는 상태가 더 나쁘다.
- 삭제 전에 `space.id`를 확보해야 하므로 현재 `deleteMany({ where: { key } })`를 `findUnique` → `delete`로 조정한다.
- v1 부채 주석("디스크 파일은 남는다")을 제거하고 새 동작을 주석으로 남긴다.

## 배포

- **helm**: S3 자격증명은 Secret(`secret.yaml`)으로, 나머지 S3 env는 values로. `STORAGE_DRIVER=s3`면 attachments PVC 마운트를 생략하는 조건부 처리 — **replicaCount>1 제약 해제** (values.yaml:78 주석 갱신). 기본값은 기존 동작 유지(local + PVC)로 하위호환.
- **docker-compose.prod.yml**: S3 env 주입 가능하게 env 목록 추가 (기본은 기존 volume 유지).
- **dev**: docker-compose에 MinIO를 추가하지 않는다 — dev/e2e는 local 드라이버로 충분하고 의존성만 는다.
- `.env.example` / `.env.prod.example`에 새 env 문서화.

## 테스트

- **local 어댑터 단위 테스트** (vitest, 신규 `tests/storage.test.ts`): tmp 디렉토리(`ATTACHMENTS_DIR` 오버라이드)로 put→get(스트림 수집)→deletePrefix 라운드트립, 경로 방어(`resolveSafe`) 케이스. 외부 의존 없음 — 순수 테스트 컨벤션 유지.
- **s3 어댑터 스모크 스크립트** (신규 `scripts/storage-smoke.mjs`, `mcp-server/smoke-test.mjs` 패턴): 실제 버킷(또는 MinIO)에 put→get→deletePrefix 라운드트립 후 정리. vitest에 넣지 않고 운영 배포 전 수동 실행. 실행법을 스크립트 헤더 주석에 문서화.
- **e2e**: 기존 첨부 테스트(권한 격리/SVG 차단)가 local 드라이버로 그대로 통과해야 함 — 어댑터 교체가 권한·보안 경로에 영향 없음을 증명. 신규 e2e 없음.

## 범위 밖

- 고아 첨부 GC (본문에서 참조 끊긴 첨부의 주기적 정리)
- presigned URL 다운로드, CDN
- 이미지 썸네일/리사이징
- 첨부 관리 UI (목록/개별 삭제)
- 기존 디스크 파일 → 버킷 마이그레이션 (기존 데이터 없음 확인됨)
