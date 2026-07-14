// 읽기 브라우징 부하: 페이지 상세 반복 조회로 렌더 캐시 효과를 측정한다.
// 실행: k6 run -e BASE_URL=http://localhost:3000 -e COOKIE="<session cookie>" deploy/loadtest/read-browse.js
import http from "k6/http";
import { check, sleep } from "k6";

const BASE = __ENV.BASE_URL || "http://localhost:3000";
const COOKIE = __ENV.COOKIE || "";
const PATH = __ENV.PAGE_PATH || "/s/eng"; // 캐시 대상 페이지 경로로 교체

export const options = {
  stages: [
    { duration: "30s", target: 50 },
    { duration: "1m", target: 50 },
    { duration: "10s", target: 0 },
  ],
  thresholds: { http_req_duration: ["p(95)<500"] },
};

export default function () {
  const res = http.get(`${BASE}${PATH}`, { headers: COOKIE ? { Cookie: COOKIE } : {} });
  check(res, { "status 200": (r) => r.status === 200 });
  sleep(1);
}
