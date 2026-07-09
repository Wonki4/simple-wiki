import { describe, it, expect } from "vitest";
import { extractWikiLinks, remarkWikiLinks } from "@/lib/wiki-links";
import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkRehype from "remark-rehype";
import rehypeStringify from "rehype-stringify";

describe("extractWikiLinks", () => {
  it("기본 링크와 라벨 링크를 추출한다", () => {
    const links = extractWikiLinks("[[배포 가이드]]와 [[온보딩|신규 입사자 문서]] 참고");
    expect(links).toEqual([
      { target: "배포 가이드", label: "배포 가이드", slug: "배포-가이드" },
      { target: "온보딩", label: "신규 입사자 문서", slug: "온보딩" },
    ]);
  });
  it("slug 기준으로 중복을 제거한다", () => {
    expect(extractWikiLinks("[[A B]] [[a b]]")).toHaveLength(1);
  });
  it("링크가 없으면 빈 배열", () => {
    expect(extractWikiLinks("일반 텍스트")).toEqual([]);
  });
});

async function render(md: string, existingSlugs: Set<string>) {
  const file = await unified()
    .use(remarkParse)
    .use(remarkWikiLinks, { spaceKey: "eng", existingSlugs })
    .use(remarkRehype)
    .use(rehypeStringify)
    .process(md);
  return String(file);
}

describe("remarkWikiLinks", () => {
  it("존재하는 페이지는 일반 위키링크로", async () => {
    const html = await render("[[배포 가이드]]", new Set(["배포-가이드"]));
    expect(html).toContain('href="/s/eng/%EB%B0%B0%ED%8F%AC-%EA%B0%80%EC%9D%B4%EB%93%9C"');
    expect(html).toContain('class="wiki-link"');
    expect(html).toContain(">배포 가이드</a>");
  });
  it("없는 페이지는 생성 링크(red link)로", async () => {
    const html = await render("[[없는 문서]]", new Set());
    expect(html).toContain("/s/eng/new?title=");
    expect(html).toContain("wiki-link-missing");
  });
  it("라벨을 표시 텍스트로 쓴다", async () => {
    const html = await render("[[온보딩|입사자 문서]]", new Set(["온보딩"]));
    expect(html).toContain(">입사자 문서</a>");
  });
  it("주변 텍스트를 보존한다", async () => {
    const html = await render("앞 [[문서]] 뒤", new Set(["문서"]));
    expect(html).toContain("앞 ");
    expect(html).toContain(" 뒤");
  });
});
