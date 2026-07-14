// MCP search-first + 편집 부하: 검색 캐싱/튜닝과 쓰기 경로를 측정한다.
// 실행: k6 run -e BASE_URL=... -e TOKEN=swk_... -e SPACE=eng deploy/loadtest/mcp-search-edit.js
import http from "k6/http";
import { check, sleep } from "k6";

const BASE = __ENV.BASE_URL || "http://localhost:3000";
const TOKEN = __ENV.TOKEN || "";
const SPACE = __ENV.SPACE || "eng";
const Q = __ENV.QUERY || "온보딩";

export const options = {
  stages: [
    { duration: "30s", target: 20 },
    { duration: "1m", target: 20 },
    { duration: "10s", target: 0 },
  ],
  thresholds: { http_req_duration: ["p(95)<800"] },
};

const auth = { headers: { Authorization: `Bearer ${TOKEN}` } };

export default function () {
  const s = http.get(`${BASE}/api/search?q=${encodeURIComponent(Q)}`, auth);
  check(s, { "search 200": (r) => r.status === 200 });
  sleep(1);
}
