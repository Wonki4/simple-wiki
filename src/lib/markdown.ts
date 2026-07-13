import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import remarkRehype from "remark-rehype";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import rehypeShiki from "@shikijs/rehype";
import rehypeStringify from "rehype-stringify";
import { remarkWikiLinks } from "./wiki-links";

// sanitize는 shiki보다 먼저 실행한다. shiki가 넣는 style 속성이 살아남도록.
const schema = {
  ...defaultSchema,
  attributes: {
    ...defaultSchema.attributes,
    a: (Array.isArray(defaultSchema.attributes?.a)
      ? defaultSchema.attributes.a.filter((item: any) => !Array.isArray(item) || item[0] !== "className")
      : []
    ).concat([["className", "wiki-link", "wiki-link-missing"]] as any) as any,
    code: (Array.isArray(defaultSchema.attributes?.code)
      ? defaultSchema.attributes.code.filter((item: any) => !Array.isArray(item) || item[0] !== "className")
      : []
    ).concat([["className", /^language-./]] as any) as any,
  },
} as any;

export interface RenderOptions {
  spaceKey: string;
  existingSlugs: Set<string>;
}

export async function renderMarkdown(markdown: string, opts: RenderOptions): Promise<string> {
  const file = await unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkWikiLinks, opts)
    .use(remarkRehype)
    .use(rehypeSanitize, schema)
    .use(rehypeShiki, {
      // 라이트 색을 인라인 color로, 다크 색을 --shiki-dark CSS 변수로 내보낸다.
      // globals.css가 prefers-color-scheme: dark에서 --shiki-dark를 활성화한다.
      themes: { light: "github-light", dark: "github-dark" },
      defaultColor: "light",
      fallbackLanguage: "text",
    })
    .use(rehypeStringify)
    .process(markdown);
  return String(file);
}
