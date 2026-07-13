# 배포

두 가지 방법을 제공합니다.

| 방법 | 대상 | Postgres/Keycloak |
|---|---|---|
| **docker-compose** (`docker-compose.prod.yml`) | 단일 호스트 셀프호스트 | 함께 번들(한 번에 기동) |
| **Helm** (`deploy/helm/simple-wiki`) | Kubernetes | 외부(관리형/기존) 사용 |

빌드되는 이미지: `simple-wiki`(앱), `simple-wiki-mcp`(원격 MCP).

---

## 1) docker-compose (올인원)

앱 + Postgres + Keycloak + MCP 를 한 번에 띄웁니다.

**사전 준비**
- Docker / Docker Compose
- 브라우저 로그인 리다이렉트를 위해 호스트 `/etc/hosts` 에 한 줄 추가(issuer 호스트 공유):
  ```
  127.0.0.1 keycloak
  ```
  (앱 컨테이너는 도커 DNS로 `keycloak`을, 브라우저는 이 hosts 항목으로 찾습니다.)

**실행**
```bash
cp .env.prod.example .env.prod        # AUTH_SECRET 등 채우기 (openssl rand -base64 32)
docker compose --env-file .env.prod -f docker-compose.prod.yml up -d --build
```

- 앱: http://localhost:3000
- Keycloak: http://localhost:8080 (admin / .env.prod 값). 테스트 계정은 realm-export 시드(alice/bob/wiki-admin)
- MCP: http://localhost:3333/mcp  (`Authorization: Bearer <PAT>`)

`migrate` 서비스가 부팅 시 `prisma migrate deploy`를 1회 실행하고 종료합니다. 첨부파일과 DB는
named volume(`attachments`, `pgdata`)에 저장됩니다.

> 참고: 번들 Keycloak은 `start-dev` 모드(데모/셀프호스트용)입니다. 대규모 운영은 아래 Helm +
> 외부 Keycloak(프로덕션 모드)을 권장합니다.

---

## 2) Helm (Kubernetes, 외부 Postgres·Keycloak)

**사전 준비**
- 외부 PostgreSQL 16 (DATABASE_URL)
- 외부 Keycloak: realm `simple-wiki`, client `simple-wiki-app`(confidential), redirectUris에 앱 공개 URL 등록
- 이미지 레지스트리에 `simple-wiki`, `simple-wiki-mcp` 푸시

**이미지 빌드·푸시**
```bash
docker build -t <registry>/simple-wiki:1.0.0 .
docker build -t <registry>/simple-wiki-mcp:1.0.0 ./mcp-server
docker push <registry>/simple-wiki:1.0.0
docker push <registry>/simple-wiki-mcp:1.0.0
```

**설치**
```bash
helm install wiki deploy/helm/simple-wiki \
  --namespace wiki --create-namespace \
  --set image.repository=<registry>/simple-wiki --set image.tag=1.0.0 \
  --set mcp.image.repository=<registry>/simple-wiki-mcp --set mcp.image.tag=1.0.0 \
  --set config.authUrl=https://wiki.example.com \
  --set config.keycloakIssuer=https://auth.example.com/realms/simple-wiki \
  --set ingress.enabled=true --set ingress.host=wiki.example.com \
  --set-string secrets.authSecret="$(openssl rand -base64 32)" \
  --set-string secrets.databaseUrl="postgresql://user:pass@pg-host:5432/wiki" \
  --set-string secrets.keycloakSecret="<keycloak client secret>"
```

운영에서는 비밀값을 values로 넘기지 말고 **기존 Secret**을 참조하세요:
```bash
--set secrets.create=false --set secrets.existingSecret=simple-wiki-secrets
# Secret은 키 AUTH_SECRET / DATABASE_URL / AUTH_KEYCLOAK_SECRET 를 가져야 함
```

**동작 방식**
- 마이그레이션: 앱 파드의 initContainer가 `prisma migrate deploy`를 실행(멱등적, Secret 존재 후 실행).
- 첨부파일: PVC(`persistence`). 기본 `ReadWriteOnce` + `replicaCount: 1`.
  스케일아웃(replicas>1 / HPA) 시 `persistence.accessMode=ReadWriteMany` 볼륨이 필요합니다(디스크 저장 한계).
- MCP: `mcp.enabled=true`(기본). 클러스터 내부에서 앱 서비스로 연결되며, 원격 노출은
  `mcp.ingress.enabled=true` + `mcp.ingress.host` 로 설정. 각 LLM이 자기 PAT를 헤더로 붙여 인증합니다.
  공개 노출 시 `mcp.allowedHosts` 로 DNS 리바인딩 보호 권장.

주요 values는 `deploy/helm/simple-wiki/values.yaml` 참고.

## 3) 에어갭 빌드 (Prisma 엔진)

폐쇄망 안에서 이미지를 빌드할 때, `prisma generate` / `prisma migrate` 는 엔진 바이너리를
`binaries.prisma.sh`(CDN)에서 받으려다 실패한다(사내 미러 없음 전제). 엔진을 연결된 머신에서
미리 받아 소스와 함께 반입하면, `Dockerfile` 이 그 엔진을 `PRISMA_QUERY_ENGINE_LIBRARY` /
`PRISMA_SCHEMA_ENGINE_BINARY` 로 가리켜 오프라인에서 빌드된다.

**전제**: 폐쇄망에 베이스 이미지(`node:22-alpine`, `postgres`, `keycloak`)와 npm 패키지가
이미 있거나 함께 반입된다(이 절은 그 미러가 잡아주지 못하는 Prisma 엔진만 다룬다). 런타임
컨테이너가 `node:*-alpine`(musl)이므로 엔진 플랫폼은 `linux-musl-openssl-3.0.x` 이다.

**A. 연결된 머신에서 (Prisma 버전당 1회)**

```bash
npm install                          # @prisma/engines-version 이 있어야 함
./scripts/vendor-prisma-engines.sh   # prisma/engines/ 에 엔진 2개 생성
```

생성물:
- `prisma/engines/libquery_engine-linux-musl-openssl-3.0.x.so.node`
- `prisma/engines/schema-engine-linux-musl-openssl-3.0.x`

이 두 파일은 대용량이라 git 에 커밋하지 않는다(`.gitignore` 처리). `prisma/engines/`
디렉터리를 소스와 함께 반입 매체(USB 등)에 담는다.

**B. 폐쇄망에서**

```bash
# 소스 + prisma/engines/ 를 함께 배치한 뒤
docker build -t simple-wiki:offline .
```

`Dockerfile` 이 `npm ci --ignore-scripts`(엔진 다운로드 시도 차단) 후, vendored 엔진을
env 로 지정해 `prisma generate` 를 오프라인으로 수행한다. 런타임 `migrate deploy` 도 같은
vendored `schema-engine` 을 쓴다.

**버전 업 시**: `package.json` 의 `prisma` 버전을 바꾸면 엔진 커밋 해시가 바뀌므로 A 를
다시 수행해 새 엔진을 반입한다.

**검증(폐쇄망)**: `docker build` 가 성공하고, 컨테이너 기동 시 initContainer 의
`prisma migrate deploy` 가 통과하면 정상이다.
