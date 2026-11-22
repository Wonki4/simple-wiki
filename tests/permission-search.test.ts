import { describe, expect, it } from "vitest";
import { canSearchSubstring } from "@/lib/permission-search";

describe("부분 검색은 추출 가능한 trigram이 있을 때만 실행한다", () => {
  it.each(["김", "민수", "a_b", "%%_", "😀😀😀", "가-나-다"])("%s는 접두 검색으로 제한한다", value => {
    expect(canSearchSubstring(value)).toBe(false);
  });
  it.each(["김민수", "alice", "ab@example.com", "123", "😀개발팀"])("%s는 부분 검색도 가능하다", value => {
    expect(canSearchSubstring(value)).toBe(true);
  });
});
