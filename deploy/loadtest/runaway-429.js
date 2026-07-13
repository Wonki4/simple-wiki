// 폭주 루프: 단일 토큰으로 대량 요청 → 429가 발동하는지 확인한다.
// 실행: k6 run -e BASE_URL=... -e TOKEN=swk_... deploy/loadtest/runaway-429.js
import http from "k6/http";
import { check } from "k6";
import { Counter } from "k6/metrics";

const BASE = __ENV.BASE_URL || "http://localhost:3000";
const TOKEN = __ENV.TOKEN || "";
const got429 = new Counter("got_429");

export const options = {
  scenarios: {
    burst: { executor: "constant-arrival-rate", rate: 200, timeUnit: "1s", duration: "20s", preAllocatedVUs: 50 },
  },
};

export default function () {
  const res = http.get(`${BASE}/api/search?q=loadtest`, { headers: { Authorization: `Bearer ${TOKEN}` } });
  if (res.status === 429) got429.add(1);
  check(res, { "200 or 429": (r) => r.status === 200 || r.status === 429 });
}

export function handleSummary(data) {
  const c = data.metrics.got_429 ? data.metrics.got_429.values.count : 0;
  return { stdout: `\n429 응답 수: ${c} (0보다 크면 rate limit 동작)\n` };
}
