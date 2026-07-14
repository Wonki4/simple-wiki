# 부하 테스트 (k6)

프로덕션 스케일링(캐싱·검색튜닝·rate limit) 효과를 측정한다. Postgres·Keycloak·앱이
떠 있어야 한다(Docker/클러스터).

## 준비
- k6 설치: https://k6.io/docs/get-started/installation/
- 세션 쿠키(읽기 테스트) 또는 PAT(MCP/폭주 테스트) 발급.

## 시나리오
| 파일 | 목적 | 실행 |
|---|---|---|
| read-browse.js | 페이지 조회 → 렌더 캐시 효과 | `k6 run -e BASE_URL=... -e COOKIE="..." -e PAGE_PATH=/s/eng/온보딩 deploy/loadtest/read-browse.js` |
| mcp-search-edit.js | 검색 캐싱/튜닝 | `k6 run -e BASE_URL=... -e TOKEN=swk_... deploy/loadtest/mcp-search-edit.js` |
| runaway-429.js | rate limit 발동 | `k6 run -e BASE_URL=... -e TOKEN=swk_... deploy/loadtest/runaway-429.js` |

## 측정
각 스케일링 변경 전후로 p50/p95 latency와 throughput을 비교한다. runaway-429는 요약에
"429 응답 수"를 출력한다(0보다 크면 rate limit 정상 동작).
