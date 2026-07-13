import { describe, it, expect } from "vitest";
import {
  PageConflictError,
  ReplaceError,
  assertExpectedVersion,
  appendContent,
  applyReplace,
  isVersionConflict,
} from "@/lib/page-edits";

describe("assertExpectedVersion", () => {
  it("expected 미지정이면 통과", () => {
    expect(() => assertExpectedVersion(5, undefined)).not.toThrow();
  });
  it("일치하면 통과", () => {
    expect(() => assertExpectedVersion(5, 5)).not.toThrow();
  });
  it("불일치면 PageConflictError(현재 버전 포함)", () => {
    try {
      assertExpectedVersion(6, 5);
      throw new Error("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(PageConflictError);
      expect((e as PageConflictError).currentVersion).toBe(6);
    }
  });
});

describe("appendContent", () => {
  it("빈 본문에 추가하면 추가분만", () => {
    expect(appendContent("", "새 줄")).toBe("새 줄");
  });
  it("기존 본문과 빈 줄 하나로 구분", () => {
    expect(appendContent("기존", "추가")).toBe("기존\n\n추가");
  });
  it("기존 본문의 꼬리 공백/개행은 정규화", () => {
    expect(appendContent("기존\n\n\n", "추가\n")).toBe("기존\n\n추가");
  });
  it("추가분이 공백뿐이면 기존 본문 유지", () => {
    expect(appendContent("기존", "   \n")).toBe("기존");
  });
});

describe("applyReplace", () => {
  it("정확히 1곳 치환", () => {
    expect(applyReplace("a b c", "b", "X")).toBe("a X c");
  });
  it("0곳이면 ReplaceError", () => {
    expect(() => applyReplace("a b c", "z", "X")).toThrow(ReplaceError);
  });
  it("2곳 이상이면 ReplaceError(개수 안내)", () => {
    try {
      applyReplace("dup dup", "dup", "X");
      throw new Error("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(ReplaceError);
      expect((e as Error).message).toContain("2곳");
    }
  });
  it("old_string이 빈 문자열이면 ReplaceError", () => {
    expect(() => applyReplace("abc", "", "X")).toThrow(ReplaceError);
  });
});

describe("isVersionConflict", () => {
  it("Prisma P2002는 true", () => {
    expect(isVersionConflict({ code: "P2002" })).toBe(true);
  });
  it("다른 코드/에러는 false", () => {
    expect(isVersionConflict({ code: "P2001" })).toBe(false);
    expect(isVersionConflict(new Error("x"))).toBe(false);
    expect(isVersionConflict(null)).toBe(false);
  });
});
