import { describe, it, expect } from "vitest";
import { renderMarkdown } from "@/lib/markdown";

const opts = { spaceKey: "eng", existingSlugs: new Set<string>(["문서"]) };

describe("renderMarkdown", () => {
  it("기본 마크다운을 렌더링한다", async () => {
    const html = await renderMarkdown("# 제목\n\n본문 **굵게**", opts);
    expect(html).toContain("<h1>제목</h1>");
    expect(html).toContain("<strong>굵게</strong>");
  });
  it("GFM 테이블을 지원한다", async () => {
    const html = await renderMarkdown("| a | b |\n|---|---|\n| 1 | 2 |", opts);
    expect(html).toContain("<table>");
  });
  it("script 태그를 제거한다 (XSS)", async () => {
    const html = await renderMarkdown('<script>alert(1)</script>\n\n<img src=x onerror=alert(1)>', opts);
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("onerror");
  });
  it("위키링크를 변환한다", async () => {
    const html = await renderMarkdown("[[문서]]와 [[없음]]", opts);
    expect(html).toContain('class="wiki-link"');
    expect(html).toContain("wiki-link-missing");
  });
  it("코드블록을 하이라이트한다", async () => {
    const html = await renderMarkdown('```ts\nconst x = 1;\n```', opts);
    expect(html).toContain("shiki");
  });
});
