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
