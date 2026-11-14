import { describe, expect, it } from "vitest";
import { applySourceEdit } from "../src/lib/source-edit";

describe("원문 편집", () => {
  const raw = "첫째  \r\n둘째\r셋째\n\r\n";
  it("혼합 개행과 끝 공백은 그대로 두고 편집한 텍스트만 바꾼다", () => {
    expect(applySourceEdit(raw, "첫째  \n둘째\n셋째\n\n")).toBe(raw);
    expect(applySourceEdit(raw, "첫째  \n수정\n셋째\n\n")).toBe(raw.replace("둘째", "수정"));
    expect(applySourceEdit(raw, "첫째  \n둘째셋째\n\n")).toBe(raw.replace("둘째\r", "둘째"));
  });
  it("새 줄은 인접한 개행 방식을 쓰고 전체 삭제와 빈 문서 입력을 허용한다", () => {
    expect(applySourceEdit("a\r\nb", "a\nb\nc")).toBe("a\r\nb\r\nc");
    expect(applySourceEdit(raw, "")).toBe("");
    expect(applySourceEdit("", "새\n문서")).toBe("새\n문서");
  });
});
