import { describe, expect, it } from "vitest";
import { liveMarkdown } from "../src/lib/live-markdown";

const options = { spaceKey: "notice", destinations: new Map([["안내", "guide"]]) };

describe("라이브 마크다운", () => {
  it("원문의 위치로 서식을 표시하고 코드·이스케이프 안의 위키링크는 변환하지 않는다", () => {
    const source = "## 제목\n\n**굵게**와 *기울임* ~~취소~~ `[[안내]]`\n\n[[안내|링크]] \\[[안내]]";
    const parts = liveMarkdown(source, options);
    expect(parts.filter(p => p.kind === "line").map(p => p.className)).toEqual(["live-heading live-h2"]);
    expect(parts.filter(p => p.kind === "mark").map(p => p.tag)).toEqual(["strong", "em", "s"]);
    expect(parts.find(p => p.html?.includes("<code>"))?.html).toBe("<code>[[안내]]</code>");
    const links = parts.filter(p => p.html?.includes("<a "));
    expect(links).toHaveLength(1);
    expect(source.slice(links[0].from, links[0].to)).toBe("[[안내|링크]]");
    expect(links[0].html).toContain('href="/s/notice/guide"');
    expect(links[0].html).toContain(">링크</a>");
  });
  it("표·코드·이미지 블록은 전체 원문 범위를 유지하고 스크립트 URL을 제거한다", () => {
    const source = "| 항목 | 상태 |\n| --- | --- |\n| 점검 | 완료 |\n\n~~~js\nconst x = '[[안내]]';\n~~~\n\n![그림](/api/attachments/example)\n\n[위험](javascript:alert%281%29)";
    const widgets = liveMarkdown(source, options).filter(p => p.kind === "widget");
    expect(widgets.filter(p => p.block)).toHaveLength(3);
    expect(widgets[0].html).toContain("<table>");
    expect(widgets[1].html).toContain("[[안내]]");
    expect(widgets[1].html).not.toContain("wiki-link");
    expect(source.slice(widgets[1].from, widgets[1].to)).toBe("~~~js\nconst x = '[[안내]]';\n~~~");
    expect(widgets[2].html).toContain('src="/api/attachments/example"');
    expect(widgets[3].html).not.toContain("javascript:");
  });
  it("중첩 목록·체크리스트·참조 링크와 스페이스 링크를 해석한다", () => {
    const source = "> - [x] **끝**\n>   - 다음\n\n[외부][ref]\n\n[ref]: https://example.com\n\n[[eng:배포#시작|배포 절]]";
    const parts = liveMarkdown(source, { ...options, otherSpaces: new Map([["eng", new Map([["배포", "deploy"]])]]) });
    const html = parts.map(p => p.html ?? "").join("");
    expect(html).toContain('type="checkbox" aria-label="완료 표시" checked');
    expect(html).toContain('href="https://example.com"');
    expect(html).toContain('/s/eng/deploy#section-%EC%8B%9C%EC%9E%91');
  });
});

function withoutMarkers(source: string) {
  const hides = liveMarkdown(source, options).filter(p => p.kind === "hide").sort((a, b) => a.from - b.from);
  let output = "", end = 0;
  for (const hide of hides) { output += source.slice(end, hide.from); end = hide.to; }
  return output + source.slice(end);
}

it("한 개·두 개 취소선과 중첩 강조에서 실제 글자를 감추지 않는다", () => {
  expect(withoutMarkers("~a~ ~~취소~~ ***굵은 기울임*** __강조__")).toBe("a 취소 굵은 기울임 강조");
});

it.each([
  ["`code`", "<code>code</code>"],
  ["`` code ` x ``", "<code>code ` x</code>"],
  ["`줄\n바꿈`", "<code>줄 바꿈</code>"],
  ["`  `", "<code>  </code>"],
  ["`&amp; <b>`", "<code>&#x26;amp; &#x3C;b></code>"],
])("인라인 코드의 공백·개행·백틱·HTML은 읽기와 동일하게 표시한다: %s", (source, html) => {
  expect(liveMarkdown(source, options).find(p => p.kind === "widget")?.html).toBe(html);
});

it("목록 안의 참조 정의도 링크와 이미지에서 사용한다", () => {
  const source = "- 항목\n\n  [ref]: /target \"설명\"\n\n[**참조**][ref]\n\n![그림][ref]";
  const html = liveMarkdown(source, options).map(p => p.html ?? "").join("");
  expect(html).toContain('href="/target" title="설명"><strong>참조</strong>');
  expect(html).toContain('src="/target" alt="그림" title="설명"');
});

it("번호 목록은 시작 번호에서 증가하고 중첩 목록은 별도로 센다", () => {
  const source = "3. 첫째\n3. 둘째\n\n   8. 내부 하나\n   8. 내부 둘\n3. 셋째";
  expect(liveMarkdown(source, options).filter(p => p.html?.includes("live-bullet")).map(p => p.html))
    .toEqual([3, 4, 8, 9, 5].map(n => `<span class="live-bullet">${n}. </span>`));
});

it("이스케이프·엔티티·강제 줄바꿈을 해석하되 HTML은 실행하지 않는다", () => {
  const parts = liveMarkdown("\\*문자\\* &amp; &#65; &lt;script&gt;\n\n줄 끝\\\n다음", options);
  expect(parts.filter(p => p.kind === "widget").map(p => p.html)).toEqual(["*", "*", "&#x26;", "A", "&#x3C;", ">"]);
  expect(withoutMarkers("줄 끝\\\n다음")).toBe("줄 끝\n다음");
  expect(withoutMarkers("줄 끝  \n다음")).toBe("줄 끝\n다음");
});

it("각주 번호는 참조 순서로 표시하고 반복 참조와 정의를 같은 대상으로 연결한다", () => {
  const parts = liveMarkdown("A[^b] B[^a] C[^a]\n\n[^a]: 설명 **a**\n\n[^b]: 설명 b", options);
  const refs = parts.filter(p => p.html?.startsWith("<sup>"));
  expect(refs.map(p => />(\d+)<\/a>/.exec(p.html!)?.[1])).toEqual(["1", "2", "2"]);
  const html = parts.map(p => p.html ?? "").join("");
  expect(html).toContain('href="#user-content-user-content-fn-a"');
  expect(html).toContain('id="user-content-user-content-fn-a"');
  expect(html).toContain('<ol start="2">');
});
