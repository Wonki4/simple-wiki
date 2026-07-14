// 순수 토큰버킷 rate limiter(프로세스 메모리). 목적은 정밀 공평성이 아니라
// 폭주 토큰(루프에 빠진 LLM 에이전트) 차단이다. replica마다 독립 버킷을 쓴다.

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterSec: number; // allowed=false일 때 다음 토큰까지 대략 초
}

export interface RateLimiterOptions {
  capacity: number; // 버킷 최대 토큰(=버스트 허용량)
  refillPerSec: number; // 초당 리필 토큰 수
}

interface Bucket {
  tokens: number;
  last: number; // 마지막 갱신 시각(ms)
}

export class RateLimiter {
  private buckets = new Map<string, Bucket>();
  constructor(private opts: RateLimiterOptions) {}

  // now: 현재 시각(ms). 테스트에서 주입한다.
  take(key: string, now: number): RateLimitResult {
    const { capacity, refillPerSec } = this.opts;
    let b = this.buckets.get(key);
    if (!b) {
      b = { tokens: capacity, last: now };
      this.buckets.set(key, b);
    }
    const elapsedSec = Math.max(0, (now - b.last) / 1000);
    b.tokens = Math.min(capacity, b.tokens + elapsedSec * refillPerSec);
    b.last = now;
    if (b.tokens >= 1) {
      b.tokens -= 1;
      return { allowed: true, remaining: Math.floor(b.tokens), retryAfterSec: 0 };
    }
    const retryAfterSec = Math.ceil((1 - b.tokens) / refillPerSec);
    return { allowed: false, remaining: 0, retryAfterSec };
  }

  // idleMs 이상 미사용 + 가득 찬 버킷을 제거해 메모리 누수를 막는다.
  sweep(now: number, idleMs: number): void {
    for (const [k, b] of this.buckets) {
      const tokens = Math.min(this.opts.capacity, b.tokens + ((now - b.last) / 1000) * this.opts.refillPerSec);
      if (now - b.last > idleMs && tokens >= this.opts.capacity) this.buckets.delete(k);
    }
  }
}

// ── 프로세스 싱글턴 + env 설정 ──
// 기본: 토큰당 60 req / 10초 → capacity 60, refill 6/s
// 잘못된 env 값(빈 문자열/문자/음수)이 Number()로 NaN이 되면 모든 토큰 트래픽이
// 영구 차단되므로, 파싱 실패 시 기본값으로 폴백한다.
function parsePositive(v: string | undefined, dflt: number): number {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : dflt;
}
const CAPACITY = parsePositive(process.env.RATE_LIMIT_CAPACITY, 60);
const REFILL = parsePositive(process.env.RATE_LIMIT_REFILL_PER_SEC, 6);
const limiter = new RateLimiter({ capacity: CAPACITY, refillPerSec: REFILL });

let sweepTimer: ReturnType<typeof setInterval> | null = null;
function ensureSweep(): void {
  if (sweepTimer) return;
  sweepTimer = setInterval(() => limiter.sweep(Date.now(), 60_000), 60_000);
  if (typeof (sweepTimer as { unref?: () => void }).unref === "function") {
    (sweepTimer as { unref: () => void }).unref();
  }
}

export function checkTokenRateLimit(tokenKey: string): RateLimitResult {
  ensureSweep();
  return limiter.take(tokenKey, Date.now());
}
