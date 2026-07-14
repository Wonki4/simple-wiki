import { describe, it, expect } from "vitest";
import { RateLimiter } from "@/lib/rate-limit";

describe("RateLimiter.take", () => {
  it("capacity만큼 즉시 허용, 그 다음은 거부", () => {
    const rl = new RateLimiter({ capacity: 3, refillPerSec: 1 });
    const t = 1000;
    expect(rl.take("a", t).allowed).toBe(true);
    expect(rl.take("a", t).allowed).toBe(true);
    expect(rl.take("a", t).allowed).toBe(true);
    const denied = rl.take("a", t);
    expect(denied.allowed).toBe(false);
    expect(denied.retryAfterSec).toBe(1); // 1초 후 토큰 1개 리필
  });

  it("시간이 지나면 리필된다", () => {
    const rl = new RateLimiter({ capacity: 2, refillPerSec: 1 });
    rl.take("a", 0);
    rl.take("a", 0); // 소진
    expect(rl.take("a", 0).allowed).toBe(false);
    expect(rl.take("a", 2000).allowed).toBe(true); // 2초 → 2토큰 리필
  });

  it("키별로 독립적이다", () => {
    const rl = new RateLimiter({ capacity: 1, refillPerSec: 1 });
    expect(rl.take("a", 0).allowed).toBe(true);
    expect(rl.take("a", 0).allowed).toBe(false);
    expect(rl.take("b", 0).allowed).toBe(true); // 다른 키는 영향 없음
  });

  it("리필이 capacity를 넘지 않는다", () => {
    const rl = new RateLimiter({ capacity: 2, refillPerSec: 1 });
    rl.take("a", 0);
    // 100초 지나도 최대 capacity=2 까지만
    expect(rl.take("a", 100000).allowed).toBe(true);
    expect(rl.take("a", 100000).allowed).toBe(true);
    expect(rl.take("a", 100000).allowed).toBe(false);
  });
});

describe("RateLimiter.sweep", () => {
  it("idle 초과 + 가득 찬 버킷을 제거한다", () => {
    const rl = new RateLimiter({ capacity: 2, refillPerSec: 1 });
    rl.take("a", 0); // 버킷 생성
    rl.sweep(100000, 60000); // 100초 경과(>60s idle), 리필로 가득 참 → 제거
    // 제거되면 새 버킷이 capacity로 시작: 연속 2회 허용 가능
    expect(rl.take("a", 100000).allowed).toBe(true);
    expect(rl.take("a", 100000).allowed).toBe(true);
    expect(rl.take("a", 100000).allowed).toBe(false);
  });
});
