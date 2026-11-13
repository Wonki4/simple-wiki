import type { Element, ElementContent, Root } from "hast";
import { SKIP, visit } from "unist-util-visit";
import { slugify } from "./slug";

export interface Section {
  id: string;
  title: string;
  depth: number;
}

function headingText(node: ElementContent): string {
  if (node.type === "text") return node.value;
  if (node.type !== "element") return "";
  if (node.tagName === "img") return String(node.properties.alt ?? "");
  return node.children.map(headingText).join("");
}

// 사용자 마크업을 sanitize한 뒤 앱이 생성한 ID와 컨트롤만 삽입한다.
export function readingMarkup(sections: Section[]) {
  const used = new Set<string>();
  return (tree: Root) => {
    visit(tree, "element", (node: Element, index, parent) => {
      if (node.tagName === "a") return SKIP;
      if (node.tagName === "img" && parent && index !== undefined && typeof node.properties.src === "string") {
        const alt = node.properties.alt;
        parent.children[index] = {
          type: "element", tagName: "a",
          properties: {
            href: node.properties.src, target: "_blank", rel: ["noopener", "noreferrer"],
            className: ["image-original"], ariaLabel: alt ? `${alt} 원본 보기` : "이미지 원본 보기",
          },
          children: [node],
        };
        return SKIP;
      }
      if (!/^h[1-6]$/.test(node.tagName) || node.properties.id) return;
      const title = headingText(node).trim();
      if (!title) return;
      const base = `section-${slugify(title) || "heading"}`;
      let id = base;
      for (let n = 2; used.has(id); n++) id = `${base}-${n}`;
      used.add(id);
      sections.push({ id, title, depth: Number(node.tagName[1]) });
      node.properties.id = id;
      node.children.push({
        type: "element", tagName: "a",
        properties: { href: `#${id}`, className: ["section-link"], ariaLabel: `${title} 링크 복사`, title: "소제목 링크 복사" },
        children: [{ type: "text", value: "#" }],
      });
    });
  };
}
