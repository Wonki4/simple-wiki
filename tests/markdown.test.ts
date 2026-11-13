import { describe, it, expect } from "vitest";
import { renderMarkdown } from "@/lib/markdown";

const opts = { spaceKey: "eng", destinations: new Map([["문서", "문서"]]) };

describe("renderMarkdown", () => {
  it("기본 마크다운을 렌더링한다", async () => {
    const { html } = await renderMarkdown("# 제목\n\n본문 **굵게**", opts);
    expect(html).toContain('<h1 id="section-제목">제목');
    expect(html).toContain("<strong>굵게</strong>");
  });
  it("GFM 테이블을 지원한다", async () => {
    const { html } = await renderMarkdown("| a | b |\n|---|---|\n| 1 | 2 |", opts);
    expect(html).toContain("<table>");
  });
  it("script 태그를 제거한다 (XSS)", async () => {
    const { html } = await renderMarkdown('<script>alert(1)</script>\n\n<img src=x onerror=alert(1)>', opts);
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("onerror");
  });
  it("위키링크를 변환한다", async () => {
    const { html } = await renderMarkdown("[[문서]]와 [[없음]]", opts);
    expect(html).toContain('class="wiki-link"');
    expect(html).toContain("wiki-link-missing");
  });
  it("코드블록을 하이라이트한다", async () => {
    const { html } = await renderMarkdown('```ts\nconst x = 1;\n```', opts);
    expect(html).toContain("shiki");
  });
});

it("같은 소제목과 숫자 접미사가 겹쳐도 목차 ID가 유일하고 표시 텍스트가 유지된다", async () => {
  const { html, sections } = await renderMarkdown("## **배포** 절차\n\n### 배포 절차-2\n\n## 배포 절차\n\n~~~\n## 코드\n~~~", opts);
  expect(sections).toEqual([
    { id: "section-배포-절차", title: "배포 절차", depth: 2 },
    { id: "section-배포-절차-2", title: "배포 절차-2", depth: 3 },
    { id: "section-배포-절차-3", title: "배포 절차", depth: 2 },
  ]);
  for (const { id } of sections) expect(html).toContain(`href="#${id}"`);
});

it("일반 이미지는 원본에 연결하고 기존 링크가 있는 이미지는 해당 목적지를 유지한다", async () => {
  const { html } = await renderMarkdown("![캡처](/api/attachments/one)\n\n[![자료](/two.png)](/guide)\n\n![잘못된 이미지](javascript:invalid)", opts);
  expect(html).toContain('href="/api/attachments/one"');
  expect(html).toContain('href="/guide"><img src="/two.png"');
  expect(html.match(/class="image-original"/g)).toHaveLength(1);
  expect(html).not.toContain("javascript:");
});

it("코드와 마크다운 링크 레이블 속 위키 문법은 본문 링크로 렌더링하지 않는다", async () => {
  const { html } = await renderMarkdown("[[문서]]\n\n`[[문서]]`\n\n~~~md\n[[문서]]\n~~~\n\n[**[[문서]]**](/guide)", opts);
  expect(html.match(/class="wiki-link"/g)).toHaveLength(1);
  expect(html).toContain('href="/guide"><strong>[[문서]]</strong>');
});
