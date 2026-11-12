import { describe, expect, it } from "vitest";
import { safeCallbackPath } from "@/lib/callback-path";

describe("safeCallbackPath", () => {
  it("같은 오리진 상대 경로는 그대로 둔다", () => {
    expect(safeCallbackPath("/s/notice/welcome?x=1")).toBe("/s/notice/welcome?x=1");
  });

  it("비어 있거나 절대·프로토콜 상대 URL이면 홈으로", () => {
    expect(safeCallbackPath(null)).toBe("/");
    expect(safeCallbackPath("")).toBe("/");
    expect(safeCallbackPath("https://evil.com")).toBe("/");
    expect(safeCallbackPath("//evil.com")).toBe("/");
    expect(safeCallbackPath("/\\evil.com")).toBe("/");
  });
});
