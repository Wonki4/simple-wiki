# prisma/engines — 에어갭 반입용 Prisma 엔진

이 디렉터리에는 Prisma 엔진 바이너리가 들어간다. **바이너리는 git 에 커밋하지 않는다**(대용량, 버전 고정). `.gitignore` 가 이 README 만 추적하고 나머지는 무시한다.

## 왜 있나

폐쇄망(에어갭)에서는 `prisma generate` / `prisma migrate` 가 엔진을 `binaries.prisma.sh`(CDN)에서 받으려다 실패한다. 사내 미러도 없으므로, 연결된 머신에서 엔진을 미리 받아 소스와 함께 반입한다. `Dockerfile` 은 여기 있는 엔진을 `PRISMA_QUERY_ENGINE_LIBRARY` / `PRISMA_SCHEMA_ENGINE_BINARY` 로 가리켜 오프라인에서 빌드한다.

## 들어가는 파일 (런타임 = node:*-alpine → musl)

- `libquery_engine-linux-musl-openssl-3.0.x.so.node` — 런타임 쿼리 + `prisma generate`
- `schema-engine-linux-musl-openssl-3.0.x` — `prisma migrate deploy`

## 반입 절차

전체 절차는 `deploy/README.md` 의 "에어갭 빌드 (Prisma 엔진)" 절을 참고한다. 요약:

1. **(연결된 머신)** `npm install` 후 `./scripts/vendor-prisma-engines.sh` 실행 → 이 디렉터리에 위 두 파일 생성.
2. 이 디렉터리를 소스와 함께 폐쇄망으로 반입.
3. **(폐쇄망)** `docker build` — 엔진을 자동으로 사용(네트워크 불필요).

Prisma 버전을 올리면 엔진 커밋 해시가 바뀌므로 1번을 다시 수행한다.
