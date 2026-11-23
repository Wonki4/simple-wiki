import { describe, expect, it } from "vitest";
import { profileImageUrl, profileInitial } from "@/lib/profile-image";

describe("Keycloak picture URL", () => {
  it("HTTPS 이미지와 사내 HTTP 주소를 지원한다", () => {
    expect(profileImageUrl("  https://id.example.com/사진.png?v=2  "))
      .toBe("https://id.example.com/%EC%82%AC%EC%A7%84.png?v=2");
    expect(profileImageUrl("http://localhost:8080/avatar.png")).toBe("http://localhost:8080/avatar.png");
  });
  it.each([
    undefined, null, {}, ["https://id.example.com/a.png"], "", "   ", "/avatar.png",
    "//id.example.com/avatar.png", "javascript:alert(1)", "data:image/svg+xml,<svg/>",
    "file:///tmp/avatar.png", "blob:https://id.example.com/avatar",
    "https://name:secret@id.example.com/avatar.png", "https://id.example.com/\nimage.png",
    `https://id.example.com/${"x".repeat(2048)}`,
  ])("유효하지 않거나 실행 가능한 값은 제외한다: %s", value => {
    expect(profileImageUrl(value)).toBeNull();
  });
});

describe("사진이 없는 사용자의 이름 표시", () => {
  it.each([
    [" 한지우 ", "한"], ["alice", "A"], ["👩‍💻 개발자", "👩‍💻"],
    ["e\u0301mile", "E\u0301"], ["", "?"], ["알 수 없음", "?"],
  ])("%s의 첫 글자를 보존한다", (name, initial) => {
    expect(profileInitial(name)).toBe(initial);
  });
});
