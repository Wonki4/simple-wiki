import { describe, it, expect } from "vitest";
import { extractWikiLinks, remarkWikiLinks, resolveWikiLink } from "@/lib/wiki-links";
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
    .use(remarkWikiLinks, { spaceKey: "eng", destinations: new Map([...existingSlugs].map(slug => [slug, slug])) })
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

it("인라인 코드, 코드 블록, 링크 안의 텍스트는 색인에서 제외한다", () => {
  const links = extractWikiLinks("**[[실제]]**\n\n`[[코드]]`\n\n~~~md\n[[예시]]\n~~~\n\n[**[[링크]]**](/guide)");
  expect(links.map(link => link.slug)).toEqual(["실제"]);
});

it("다른 스페이스와 문서·소제목·별칭을 분리하고 코드 예시를 건너뛴다", () => {
  const links = extractWikiLinks("[[eng:배포 가이드#설치|절차]] [[#설치]] [[로컬#설치]] `[[secret:private]]`");
  expect(links.map(({ space, slug, section, label }) => [space, slug, section, label])).toEqual([
    ["eng", "배포-가이드", "설치", "절차"], [undefined, "", "설치", "#설치"], [undefined, "로컬", "설치", "로컬#설치"],
  ]);
});

it("깨진 링크 검사에서도 구분자가 포함된 기존 제목과 이전 이름을 실제 주소로 해석한다", () => {
  const options = {
    spaceKey: "notice",
    destinations: new Map([["eng-배포-절차", "legacy"], ["이전-제목", "guide"]]),
    otherSpaces: new Map([["eng", new Map([["배포", "deploy"]])]]),
  };
  const links = extractWikiLinks("[[eng:배포#절차]] [[이전 제목#설치]] [[#시작]]");
  expect(links.map(link => resolveWikiLink(link, options))).toEqual([
    { kind: "page", spaceKey: "notice", slug: "legacy" },
    { kind: "page", spaceKey: "notice", slug: "guide", section: "설치" },
    { kind: "page", spaceKey: "notice", slug: "", section: "시작" },
  ]);
});

it("읽을 수 있는 대상이 누락된 경우와 접근할 수 없는 스페이스를 구분한다", () => {
  const options = { spaceKey: "notice", destinations: new Map(), otherSpaces: new Map([["eng", new Map()]]) };
  const links = extractWikiLinks("[[문서#절|별칭]] [[eng:문서#절]] [[hidden:문서]]");
  expect(links.map(link => resolveWikiLink(link, options))).toEqual([
    { kind: "missing", spaceKey: "notice", title: "문서" },
    { kind: "missing", spaceKey: "eng", title: "문서" },
    null,
  ]);
});

it("이스케이프와 문자 엔티티로 작성한 대괄호는 링크나 백링크로 해석하지 않는다", async () => {
  const source = String.raw`\[[문서]] &#91;&#91;문서]] [[문서]] \\[[문서]]`;
  expect(extractWikiLinks(source)).toHaveLength(1);
  const html = await render(source, new Set(["문서"]));
  expect(html.match(/class="wiki-link"/g)).toHaveLength(2);
  expect(html).toContain("[[문서]]");
});

it("인용문의 이어지는 줄과 엔티티를 포함한 이름에서도 원문 위치를 구분한다", () => {
  const source = "> 줄\n> \\[[제외]] [[A &amp; B]]\n> [[포함]]";
  expect(extractWikiLinks(source).map(link => link.target)).toEqual(["A & B", "포함"]);
});
