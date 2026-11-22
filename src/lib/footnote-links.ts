import type { Root } from "hast";
import { visit } from "unist-util-visit";

// remark's footnote IDs are already prefixed. Sanitize adds its own prefix to
// IDs; reconnect only generated footnote anchors after that safety step.
export function footnoteLinks() {
  return (tree: Root) => {
    const ids = new Set<string>();
    visit(tree, "element", node => { if (node.properties.id) ids.add(String(node.properties.id)); });
    visit(tree, "element", node => {
      if (node.properties.dataFootnoteRef === undefined && node.properties.dataFootnoteBackref === undefined) return;
      const href = node.properties.href;
      if (typeof href !== "string" || !href.startsWith("#") || ids.has(href.slice(1))) return;
      const target = "user-content-" + href.slice(1);
      if (ids.has(target)) node.properties.href = "#" + target;
    });
  };
}
