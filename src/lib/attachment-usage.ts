import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import remarkRehype from "remark-rehype";
import { visit } from "unist-util-visit";
import { prisma } from "./db";

// 읽기 화면과 동일하게 참조형 링크와 이미지를 해석한다. 코드와 미사용 링크 정의는 요소를 만들지 않는다.
const parser = unified().use(remarkParse).use(remarkGfm).use(remarkRehype);

export function attachmentIdsInMarkdown(content: string, pageUrl: URL) {
  const tree = parser.runSync(parser.parse(content));
  const ids = new Set<string>();
  visit(tree, "element", node => {
    const target = node.tagName === "img" ? node.properties.src : node.tagName === "a" ? node.properties.href : undefined;
    if (typeof target !== "string") return;
    const url = URL.parse(target, pageUrl);
    if (url?.origin !== pageUrl.origin) return;
    const match = /^\/api\/attachments\/([^/]+)\/?$/.exec(url.pathname);
    if (!match) return;
    try { ids.add(decodeURIComponent(match[1])); } catch { return; }
  });
  return ids;
}

export async function listAttachmentUsage(space: { id: string; key: string }, filename: string) {
  const files = await prisma.attachment.findMany({
    where: { spaceId: space.id, filename: { contains: filename.replace(/[\\%_]/g, "\\$&"), mode: "insensitive" } },
    orderBy: [{ createdAt: "desc" }, { id: "asc" }],
    select: { id: true, filename: true, createdAt: true, size: true },
  });
  const results = files.map(file => ({ ...file, pages: [] as { slug: string; title: string }[] }));
  if (!results.length) return results;
  const filesById = new Map(results.map(file => [file.id, file]));
  const pages = await prisma.page.findMany({
    where: { spaceId: space.id, deletedAt: null, content: { contains: "attachments" } },
    select: { slug: true, title: true, content: true },
    orderBy: [{ title: "asc" }, { slug: "asc" }],
  });
  for (const { slug, title, content } of pages) {
    const pageUrl = new URL(`/s/${encodeURIComponent(space.key)}/${encodeURIComponent(slug)}`, process.env.AUTH_URL ?? "http://localhost:3000");
    for (const id of attachmentIdsInMarkdown(content, pageUrl)) filesById.get(id)?.pages.push({ slug, title });
  }
  return results;
}
