// Only reads the isolated app. Tokens are supplied through a private local file.
import { readFileSync, writeFileSync } from "node:fs";
import { performance } from "node:perf_hooks";

const base = process.env.PERF_BASE_URL ?? "http://localhost:3001";
if (base !== "http://localhost:3001") throw Error("Dedicated performance app required");
const tokens = JSON.parse(readFileSync(process.env.PERF_TOKEN_FILE, "utf8"));
const seconds = Number(process.env.PERF_SECONDS ?? 30);
const stages = (process.env.PERF_CONCURRENCY ?? "1,10,30").split(",").map(Number);
if (!Array.isArray(tokens) || !tokens.length || !Number.isFinite(seconds) || seconds <= 0
    || !stages.every(n => Number.isInteger(n) && n > 0 && n <= 100)) throw Error("Invalid load parameters");
const output = process.env.PERF_OUTPUT;
const summaries = [];
let sequence = 0;

function queryFor(n) {
  const id = String((n * 7919) % 10_000_000 + 1).padStart(8, "0");
  const choices = [
    ["exact-user", `user${id}`, `u${id}`],
    ["rare-substring", id, null],
    ["common-prefix", "김", null],
    ["short-prefix", "개발", null],
    ["common-substring", "bench.example", null],
    ["absent", `nevermatch${id}`, null],
    ["short-absent", "쀍쀍", null],
    ["group-prefix", "플랫폼", null],
  ];
  return choices[n % choices.length];
}
const percentile = (samples, p) => samples.length ? samples[Math.min(samples.length - 1, Math.ceil(samples.length * p) - 1)] : null;
for (const concurrency of stages) {
  const start = performance.now();
  const deadline = start + seconds * 1000;
  const firstSequence = sequence;
  const minimumRequests = Number(process.env.PERF_MIN_REQUESTS ?? 0);
  const records = [];
  await Promise.all(Array.from({ length: concurrency }, async () => {
    while (performance.now() < deadline || sequence - firstSequence < minimumRequests) {
      const n = sequence++;
      const [scenario, query, exactId] = queryFor(n);
      const began = performance.now();
      let status = 0;
      let correct = false;
      try {
        const response = await fetch(`${base}/api/spaces/perf/permission-subjects?q=${encodeURIComponent(query)}`, {
          headers: { Authorization: `Bearer ${tokens[n % tokens.length]}` }, signal: AbortSignal.timeout(30_000),
        });
        status = response.status;
        if (response.ok) {
          const result = await response.json();
          correct = Array.isArray(result.items) && result.items.length <= 20 && typeof result.hasMore === "boolean"
            && (exactId ? result.items.some(item => item.type === "user" && item.id === exactId) : true)
            && (["absent", "short-absent"].includes(scenario) ? result.items.length === 0 : result.items.length > 0);
        } else await response.arrayBuffer();
      } catch { /* Count transport failures/timeouts as errors. */ }
      records.push({ scenario, ms: performance.now() - began, status, correct });
    }
  }));
  const elapsedSeconds = (performance.now() - start) / 1000;
  const latencies = records.map(r => r.ms).sort((a, b) => a - b);
  const byScenario = Object.fromEntries([...new Set(records.map(r => r.scenario))].map(scenario => {
    const rows = records.filter(r => r.scenario === scenario);
    const times = rows.map(r => r.ms).sort((a, b) => a - b);
    return [scenario, { requests: rows.length, errors: rows.filter(r => !r.correct).length, p50: percentile(times, .5), p95: percentile(times, .95), p99: percentile(times, .99) }];
  }));
  const summary = { concurrency, requestedSeconds: seconds, elapsedSeconds, requests: records.length,
    rps: records.length / elapsedSeconds, errors: records.filter(r => !r.correct).length,
    statuses: records.reduce((counts, r) => ({ ...counts, [r.status]: (counts[r.status] ?? 0) + 1 }), {}),
    p50: percentile(latencies, .5), p95: percentile(latencies, .95), p99: percentile(latencies, .99), byScenario };
  summaries.push(summary);
  console.log(JSON.stringify(summary));
  if (output) writeFileSync(output, JSON.stringify({ base, mode: "closed-loop; no think time", summaries }, null, 2));
}
if (summaries.some(stage => stage.errors > 0)) process.exitCode = 1;
