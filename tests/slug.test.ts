import { describe, it, expect } from "vitest";
import { slugify } from "@/lib/slug";

describe("slugify", () => {
  it("공백을 하이픈으로, 소문자로", () => {
    expect(slugify("Hello World")).toBe("hello-world");
  });
  it("한글을 보존한다", () => {
    expect(slugify("배포 가이드")).toBe("배포-가이드");
  });
  it("특수문자를 제거하고 앞뒤 하이픈을 정리한다", () => {
    expect(slugify("  배포 가이드 (v2)!  ")).toBe("배포-가이드-v2");
  });
  it("사용 가능한 문자가 없으면 빈 문자열", () => {
    expect(slugify("!!!")).toBe("");
  });
});
