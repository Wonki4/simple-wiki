import { parse, type DefaultTreeAdapterTypes as Nodes } from "parse5";
import { describe, expect, it } from "vitest";
import { buildHtmlPreview } from "@/lib/html-preview";

function elements(source: string): Nodes.Element[] {
  const result: Nodes.Element[] = [];
  function collect(parent: Nodes.ParentNode) {
    for (const child of parent.childNodes) {
      if ("tagName" in child) {
        result.push(child);
        collect(child);
      }
    }
  }
  collect(parse(buildHtmlPreview(source)));
  return result;
}

describe("agent HTML preview", () => {
  it("keeps designed reports, native disclosures, SVG charts and inline raster images", () => {
    const html = buildHtmlPreview(`<!doctype html><html lang="ko"><head><title>성능</title>
      <style>.metric { color: green; }</style></head>
      <body><h1 class="metric">결과</h1><details open><summary>표</summary><table>
      <tr><th scope="row">동시 요청</th><td style="--value:30">30</td></tr></table></details>
      <svg viewBox="0 0 20 10"><rect width="10" height="5"/></svg>
      <img alt="점" src="data:image/png;base64,iVBORw0KGgo="></body></html>`);
    expect(html).toContain('<html lang="ko">');
    expect(html).toContain("<style>.metric { color: green; }</style>");
    expect(html).toContain('<h1 class="metric">결과</h1>');
    expect(html).toContain('<details open=""><summary>표</summary><table>');
    expect(html).toContain('<td style="--value:30">30</td>');
    expect(html).toContain('<svg viewBox="0 0 20 10"><rect width="10" height="5">');
    expect(html).toContain('src="data:image/png;base64,');
  });

  it("places the restrictive app policy before any author style and drops author policies and resource hints", () => {
    const all = elements(`<html style="color:red"><head><base href="/">
      <meta http-equiv="refresh" content="0"><meta http-equiv="Content-Security-Policy" content="default-src *">
      <link rel="preconnect" href="https://assets.example"><style>@import "https://assets.example";</style>
      </head><body>hi</body></html>`);
    const head = all.find(el => el.tagName === "head")!;
    const first = head.childNodes.find(node => "tagName" in node) as Nodes.Element;
    expect(first.tagName).toBe("meta");
    const policy = first.attrs.find(a => a.name === "content")?.value;
    expect(policy).toContain("default-src 'none'");
    expect(policy).toContain("style-src 'unsafe-inline';");
    expect(policy).toContain("img-src data:;");
    expect(policy).toContain("base-uri 'none'");
    expect(policy).toContain("form-action 'none'");
    expect(all.filter(el => el.tagName === "meta")).toHaveLength(3);
    expect(all.some(el => ["base", "link"].includes(el.tagName))).toBe(false);
    expect(all[0].attrs).not.toContainEqual(expect.objectContaining({ name: "style" }));
  });

  it("removes navigable links, embedded browsing contexts, active controls and network attributes", () => {
    const doc = buildHtmlPreview(`<a href="#chart" target="_top" ping="/stats">Chart</a>
      <iframe src="/embed"></iframe><form action="/submit"><input name="x"></form>
      <script type="application/json">{"name":"fixture"}</script>
      <template><span>hidden template</span></template><noscript>alternative</noscript>
      <img src="/local-image" srcset="/large-image 2x" onerror="" alt="이미지">
      <svg><use href="/icon.svg#shape"/><foreignObject><p>foreign</p></foreignObject></svg>`);
    expect(doc).toContain("<a>Chart</a>");
    expect(doc).toContain('<img alt="이미지">');
    expect(doc).toContain("<svg></svg>");
    for (const disallowed of ["<iframe", "<form", "<script", "<template", "<noscript", "onerror=", "srcset=", "target=", "ping="]) {
      expect(doc).not.toContain(disallowed);
    }
  });

  it("accepts fragments and incomplete documents and bounds nested markup", () => {
    expect(buildHtmlPreview("plain text")).toContain("<body>plain text</body>");
    expect(buildHtmlPreview("<h1>draft")).toContain("<h1>draft</h1>");
    const nested = buildHtmlPreview("<div>".repeat(1000));
    expect(nested.match(/<div>/g)!.length).toBeLessThan(130);
  });
});
