import { parse, parseFragment, serialize, type DefaultTreeAdapterTypes as Nodes } from "parse5";

const htmlTags = new Set(`
  html head body title style main article section aside header footer nav div span p
  h1 h2 h3 h4 h5 h6 hgroup address a abbr b bdi bdo br cite code data del dfn em i
  ins kbd mark q rp rt ruby s samp small strong sub sup time u var wbr blockquote
  figure figcaption hr ol ul li dl dt dd pre table caption colgroup col thead tbody
  tfoot tr td th details summary img meter progress
`.trim().split(/\s+/));
const svgTags = new Set("svg g title desc defs path rect circle ellipse line polyline polygon text tspan linearGradient radialGradient stop clipPath".split(" "));
const htmlAttrs = new Set("alt width height colspan rowspan headers scope span start reversed value open datetime low high optimum min max".split(" "));
const svgAttrs = new Set(`
  viewBox preserveAspectRatio x y x1 x2 y1 y2 cx cy r rx ry width height d points
  fill fill-opacity fill-rule stroke stroke-width stroke-linecap stroke-linejoin
  stroke-dasharray stroke-dashoffset stroke-opacity opacity transform clip-path
  offset stop-color stop-opacity gradientUnits gradientTransform text-anchor
  font-size font-family font-weight dominant-baseline dx dy
`.trim().split(/\s+/));
const globalAttrs = new Set(["class", "id", "title", "lang", "dir", "role", "style", "hidden"]);
const htmlNamespace = "http://www.w3.org/1999/xhtml";
const svgNamespace = "http://www.w3.org/2000/svg";
const inlineRaster = /^data:image\/(?:png|jpeg|gif|webp|avif);base64,[a-z\d+/=\s]+$/i;

// External stylesheets, CSS resources, fonts and network connections are blocked.
// srcdoc has a meta policy because it does not receive its own response headers.
const trustedHead = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'">
<meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="no-referrer">`;

function keepAttribute(element: Nodes.Element, attr: Nodes.Element["attrs"][number]): boolean {
  if (attr.namespace || attr.prefix) return false;
  const { name, value } = attr;
  if (name === "style" && (element.tagName === "html" || element.tagName === "head")) return false;
  if (globalAttrs.has(name) || name.startsWith("aria-") || name.startsWith("data-")) return true;
  if (element.namespaceURI === svgNamespace) return svgAttrs.has(name);
  if (element.tagName === "img" && name === "src") return inlineRaster.test(value);
  return htmlAttrs.has(name);
}

function cleanChildren(parent: Nodes.ParentNode, depth: number): void {
  // Bound traversal and serialization depth even for documents with malformed nesting.
  if (depth >= 128) {
    parent.childNodes = [];
    return;
  }
  parent.childNodes = parent.childNodes.filter(node => {
    if (node.nodeName === "#text") return true;
    if (!("tagName" in node)) return false;
    const allowed = node.namespaceURI === htmlNamespace ? htmlTags : svgTags;
    if ((node.namespaceURI !== htmlNamespace && node.namespaceURI !== svgNamespace) || !allowed.has(node.tagName)) return false;
    node.attrs = node.attrs.filter(attr => keepAttribute(node, attr));
    cleanChildren(node, depth + 1);
    return true;
  });
}

/** Render only in an iframe with an empty sandbox attribute (opaque origin). */
export function buildHtmlPreview(source: string): string {
  const document = parse(source);
  cleanChildren(document, 0);
  const html = document.childNodes.find((node): node is Nodes.Element => "tagName" in node && node.tagName === "html")!;
  const head = html.childNodes.find((node): node is Nodes.Element => "tagName" in node && node.tagName === "head")!;
  head.childNodes.unshift(...parseFragment(trustedHead).childNodes);
  return "<!doctype html>" + serialize(document);
}
