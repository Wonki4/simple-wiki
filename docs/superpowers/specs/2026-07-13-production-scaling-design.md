# simple-wiki 프로덕션 스케일링 설계

**작성일:** 2026-07-13
**대상 브랜치:** feat/wiki-v1 (또는 후속 브랜치)
**목표:** 사내 3만 명 + MCP/LLM 부하를 실전 프로덕션 수준에서 감당하도록, 읽기 캐싱·검색 캐싱/튜닝·토큰별 rate limit·커넥션 설정·수평 확장을 기존 Next.js 풀스택 + Prisma + Helm 위에 얹는다. **새 인프라 컴포넌트(Redis·PgBouncer)는 도입하지 않는다.**

## 배경 / 문제

현재 코드는 정확성 위주로 작성돼 있고 처리량 튜닝이 없다. 그대로 3만 명 + MCP에 올리면 다음이 병목이 된다.

1. **읽기 캐싱 부재** — 페이지 조회마다 DB 조회 + `renderMarkdown`(Shiki 코드 하이라이팅, CPU 비용 큼)을 재실행한다. 본문은 편집 시에만 바뀌는데 매 조회 재렌더하는 것은 낭비이며, Node CPU가 먼저 포화된다.
2. **검색이 MCP 특유의 hot path** — `SERVER_INSTRUCTIONS`가 LLM에게 "먼저 search_pages를 써라"고 유도한다. 검색 쿼리에는 결과마다 `ts_headline`(스니펫 생성, CPU)이 붙고 `ILIKE '%q%'`도 있다. 사람은 검색이 드물지만 LLM은 작업마다 검색부터 하므로 이 경로가 상대적으로 뜨겁다.
3. **토큰별 rate limit 부재** — PAT(MCP) 인증 경로에 요청 제한이 전혀 없다. 사람은 손이 느려 자연 제한되지만, 폭주하는 LLM 에이전트는 무한정 API를 두드린다. 3만 명 각자 에이전트를 붙이는 그림에서 폭주 토큰 하나가 서버를 갉아먹을 수 있다.
4. **커넥션 미튜닝 + 단일 인스턴스** — `src/lib/db.ts`는 `new PrismaClient()` 기본값이라 `connection_limit`이 명시돼 있지 않다. Node를 여러 대로 확장하면 인스턴스마다 풀을 열어 Postgres `max_connections`를 소진할 수 있다. 또한 단일 프로세스로는 CPU 코어를 다 못 쓴다.

## 규모 감각 (설계 근거)

3만 명은 가입자이지 동시 접속이 아니다. 사내 위키의 실제 부하는 하루 활성 6천~1.2만 명, 하루 20~40만 요청, 업무시간 피크 초당 수십~백 rps 수준이다. 읽기가 압도적이고 편집은 드물다. 따라서 아키텍처(Next.js 풀스택 + Postgres)는 한계가 아니며, 빠진 것은 캐싱·rate limit·수평 확장 설정이다. MCP 트래픽은 사람 브라우징보다 양이 적고 버스트성이지만, 부하가 실리는 지점(검색·쓰기·무제한 토큰)이 달라 별도 대응이 필요하다.

## 설계 원칙

- **인프라 0 추가**: Redis·PgBouncer를 쓰지 않는다. 앱 코드(캐싱·rate limit·검색 튜닝) + Helm/Postgres 설정(connection_limit·max_connections·HPA)으로만 해결한다.
- **리라이트 아닌 애드온**: 기존 경로를 감싸거나 설정을 얹는다. 도메인 로직·API 계약은 바꾸지 않는다.
- **위키 특성 활용**: 읽기 위주, 편집 드묾, 편집 후 수십 초 staleness 허용.

## 작업 ①: 읽기 캐싱 (Next.js 내장 캐시)

**핵심 비용**: 페이지 상세(`src/app/s/[spaceKey]/[slug]/page.tsx`)가 매 요청 `prisma.page.findUnique` + `renderMarkdown`(Shiki)을 실행한다. 본문은 편집 시에만 바뀐다.

**구현**:
- 렌더 결과(마크다운 → HTML 문자열)를 `unstable_cache`로 감싼다. 캐시 키는 `["page-render", spaceKey, slug]`, 태그는 `page:{pageId}` 및 `space:{spaceId}`.
- **TTL 60초**를 설정한다(`unstable_cache`의 `revalidate: 60`). 이는 다중 replica 환경에서 다른 replica의 로컬 캐시가 최대 60초까지 stale할 수 있는 상한이다. 위키에는 허용 가능하다.
- **무효화**: 쓰기가 일어나는 단일 경로 `commitRevision`(`src/lib/pages.ts`)과 삭제(`deletePage`)에 `revalidateTag(\`page:${pageId}\`)`를 건다. `updatePageInSpace`/`editPageContent`/`revertPage`/create/delete가 모두 `commitRevision`(또는 create의 초기 리비전)으로 수렴하므로 무효화를 소수 지점에만 걸면 전 경로가 커버된다. 편집을 처리한 replica는 즉시 무효화되어 편집자 본인은 최신을 보고, 나머지 replica는 TTL 내에 수렴한다.

**보안 (필수)**:
- 캐시에 담는 것은 **렌더된 본문(HTML)뿐**이며, 이는 열람자와 무관한 순수 변환 결과다.
- **권한 판정(`requireSpaceRole`)은 캐시 밖에서 매 요청 실행한다.** RSC는 먼저 권한을 확인하고, 통과한 뒤에만 캐시된 렌더 결과를 사용한다. 권한 결정을 절대 캐시하지 않으므로 무권한자에게 내용이 유출되지 않는다.

**대상 파일**: `src/lib/markdown.ts`(또는 렌더 호출부를 감싸는 새 헬퍼 `src/lib/page-cache.ts`), `src/lib/pages.ts`(무효화 훅), `src/app/s/[spaceKey]/[slug]/page.tsx`.

## 작업 ②: 검색 캐싱 + 쿼리 튜닝

**② -1 검색 결과 캐싱**:
- `searchPages(q, readableSpaceIds)`(`src/lib/search.ts`)의 결과를 **TTL 30초**로 캐시한다.
- **캐시 키에 반드시 `정렬된 readableSpaceIds`와 `query`를 함께 포함한다.** 권한 격리의 핵심이다 — 같은 스페이스 집합을 읽을 수 있는 사용자끼리만 캐시를 공유하며, 권한이 다른 사용자가 서로의 결과를 보지 못한다.
- 태그 무효화는 하지 않는다(30초 TTL로 자연 만료). 검색 결과의 30초 staleness는 허용 가능하다.

**② -2 쿼리 튜닝**:
- 현재 쿼리는 `ts_headline`을 SELECT 절에서 계산하는데, `ORDER BY ... LIMIT 50` 이전에 WHERE를 통과한 행들에 대해 계산될 수 있어 비용이 크다.
- **서브쿼리(또는 CTE)로 `WHERE + ORDER BY + LIMIT 50`을 먼저 수행해 상위 50행만 확정한 뒤, 바깥 쿼리에서 그 50행에만 `ts_headline`을 적용한다.** 스니펫 생성 비용을 결과 수(≤50)로 제한한다.
- 기존 `searchVector @@ ...` GIN 인덱스, `pg_trgm` 인덱스, `LIMIT 50`은 유지한다.

**대상 파일**: `src/lib/search.ts`, `src/app/api/search/route.ts`(캐싱 래핑 위치는 lib).

## 작업 ③: 토큰별 rate limit (메모리 토큰버킷)

**적용 지점**: API 인증 경로. `resolveApiActor`가 토큰(PAT) 행위자를 판정하는 지점(`src/lib/api-auth.ts`) 또는 `requireApiSpaceRole` 진입부.

**규칙**:
- **PAT/MCP 토큰 행위자에만 적용한다**(브라우저 세션은 사람이라 자연 제한되므로 제외). `ApiActor.via === "token"`일 때만 검사.
- 토큰 id(또는 tokenHash) 기준 **메모리 토큰버킷**을 replica 프로세스 내에 유지한다. 목적은 정밀한 전역 공평성이 아니라 **폭주 루프 차단**이다(폭주 에이전트는 요청량이 많아 per-replica 버킷도 빠르게 소진시킨다).
- 초과 시 **HTTP 429** + `Retry-After` 헤더를 반환한다.
- 한도는 환경변수로 설정한다(기본값 예: 토큰당 60 requests / 10초 window). 운영 시 `limit ≈ 목표처리량 ÷ replica 수`로 조정한다.
- 메모리 `Map`을 쓰되 **주기적 정리(오래된 버킷 제거)로 메모리 누수를 방지**한다.

**대상 파일**: 새 `src/lib/rate-limit.ts`(순수 토큰버킷 로직 + 단위 테스트 가능), `src/lib/api-auth.ts`(적용).

## 작업 ④: 커넥션 설정 튜닝 (PgBouncer 대체)

**근거**: 읽기 캐싱으로 대부분의 읽기가 DB에 닿지 않아 활성 커넥션이 줄고, replica 수가 완만하면(HPA max ~14 pod × connection_limit 5 ≈ 70) Postgres `max_connections`를 적정 사이징으로 감당할 수 있다. 별도 풀러의 운영·모니터링 비용과 Prisma+transaction-pooling 주의사항(`pgbouncer=true`, prepared statement 비활성)을 피한다.

**구현**:
- Prisma 접속 문자열(`DATABASE_URL`)에 **`connection_limit=<N>`을 명시**해 replica당 커넥션 상한을 고정한다(예: 5). `src/lib/db.ts`는 문자열 파라미터로 제어되므로 코드 변경 없이 env로 조정 가능하다.
- Postgres **`max_connections`를 `HPA_max × connection_limit + 여유(마이그레이션·관리·모니터링)`로 사이징**한다(예: 150~200).
- Helm values에 `connection_limit`과 Postgres 사이징 가이드를 노출한다.
- deploy 문서에 **재검토 임계치**를 명시한다: "HPA maxReplicas를 20~30 이상으로 키우거나 서버리스/엣지를 도입해 커넥션이 빠르게 생성·소멸하면 그때 PgBouncer(transaction pooling)를 도입한다."

**대상 파일**: `deploy/helm/simple-wiki/values.yaml`(connection_limit 노출), `deploy/README.md`(사이징 + 임계치), `.env.prod.example`.

## 작업 ⑤: 수평 확장 (replica + HPA)

**근거**: app과 mcp-server는 모두 무상태다(세션은 Keycloak/JWT, MCP http는 `sessionIdGenerator: undefined` stateless). sticky session이 불필요하므로 로드밸런서 뒤에서 N대로 확장할 수 있다.

**구현**:
- Helm에 app·mcp-server **HPA**를 추가한다(CPU 사용률 타깃 예: 70%, `minReplicas: 2`, `maxReplicas: <N>`). 기존 `replicaCount`는 min 기준으로 유지.
- Postgres는 **단일 primary를 유지**한다. 읽기가 캐시로 빠져 DB 부하가 낮으므로 이 규모에는 충분하다. 읽기 replica(read scaling)는 본 스펙 범위 밖(future)이다.
- HPA `maxReplicas × connection_limit`이 작업 ④의 `max_connections` 사이징과 일관되도록 두 값을 함께 문서화한다.

**대상 파일**: `deploy/helm/simple-wiki/templates/`(app-hpa.yaml, mcp-hpa.yaml 신규), `values.yaml`(autoscaling 블록), `deploy/README.md`.

## 검증: 부하 테스트

**도구**: k6(권장) 또는 autocannon. 스크립트는 저장소 `deploy/loadtest/`에 둔다.

**시나리오 3종**:
1. **읽기 브라우징**: 다수 가상 사용자가 페이지 목록 → 페이지 상세를 반복 조회. 캐시 적중률과 p50/p95 latency, throughput을 측정.
2. **MCP search-first + 편집**: 토큰으로 search_pages → get_page → append/replace를 반복. 검색 캐싱·튜닝 효과와 쓰기 경로 부하를 측정.
3. **폭주 루프**: 단일 토큰으로 짧은 간격 대량 요청 → **429가 발동하고 다른 토큰·세션에 영향이 없는지** 확인.

**측정**: 각 작업(①~⑤) 적용 전후로 p50·p95 latency와 최대 throughput을 비교해 개선을 수치로 확인한다.

**주의**: 부하 테스트는 Postgres·Keycloak 컨테이너(Docker)가 필요하다. 현재 세션에서 Docker 데몬이 다운된 경우 스크립트는 작성만 하고, 인프라 복구 후 실행한다.

## 롤아웃 순서 (의존성)

1. **토큰별 rate limit** — 독립적이고 값싸며 안전 장치이므로 먼저.
2. **읽기 캐싱 + 검색 캐싱** — 효과가 가장 크고 앱 코드만 건드린다.
3. **검색 쿼리 튜닝** — ts_headline 서브쿼리.
4. **커넥션 설정 튜닝** — replica 확장의 안전판.
5. **replica + HPA** — 작업 ④의 커넥션 사이징에 의존.
6. **부하 테스트** — 전체 검증.

## 컴포넌트 경계 요약

| 유닛 | 책임 | 의존 |
|---|---|---|
| `page-cache` 래퍼 | 렌더 HTML 캐시 + 태그 무효화 | unstable_cache, commitRevision |
| `search`(개정) | 결과 캐싱 + ts_headline 서브쿼리 | unstable_cache, Postgres |
| `rate-limit` | 토큰버킷 순수 로직 | 없음(순수) — api-auth가 적용 |
| Helm autoscaling/커넥션 | HPA + connection_limit + max_connections | 기존 Helm 차트 |
| `deploy/loadtest` | k6 시나리오 3종 | 실행 인프라 |

## 테스트 전략

- **단위(vitest)**: `rate-limit` 토큰버킷(허용/거부/윈도우 리필/정리); 검색 캐시 키 생성이 readableSpaceIds를 포함하는지(권한 격리); 캐시 무효화 태그 계산.
- **e2e(playwright)**: 편집 후 페이지 재조회 시 최신 내용 반영(캐시 무효화); 검색 권한 격리 유지(기존 테스트가 캐싱 후에도 통과); 단일 토큰 폭주 시 429, 다른 토큰은 정상(rate limit 격리).
- **부하(k6)**: 위 3 시나리오, 인프라 복구 후 실행.

## 범위 밖 (이번 스펙 제외)

- Redis 도입(캐시·rate limit 공유 저장소) — 인프라 0 원칙에 따라 제외. 다중 replica 정밀 공평성이 필요해지면 별도 이터레이션.
- PgBouncer — 커넥션 설정 튜닝으로 대체. HPA를 20~30 replica 이상으로 키울 때 재검토.
- Postgres 읽기 replica(read scaling), 샤딩.
- CDN/엣지 캐싱.
- 에어갭 전용 빌드 — **별도 하위 프로젝트로 독립 스펙에서 다룬다.**
