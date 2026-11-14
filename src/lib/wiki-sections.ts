import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import remarkRehype from "remark-rehype";
import rehypeSanitize from "rehype-sanitize";
import { readingMarkup, type Section } from "./reading-markup";
import { remarkWikiLinks } from "./wiki-links";

const parser = unified().use(remarkParse).use(remarkGfm)
  .use(remarkWikiLinks, { spaceKey: "", destinations: new Map() })
  .use(remarkRehype).use(rehypeSanitize);

export function wikiSections(markdown: string) {
  const tree = parser.runSync(parser.parse(markdown));
  const sections: Section[] = [];
  readingMarkup(sections)(tree);
  return sections;
}
