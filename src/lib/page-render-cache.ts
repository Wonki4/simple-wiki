import { unstable_cache, revalidateTag } from "next/cache";
import { linkedSpaces, wikiLinkOptions, spaceLinksTag } from "./wiki-link-destinations";
import { renderMarkdown } from "@/lib/markdown";

export function pageCacheTag(pageId: string): string {
  return `page:${pageId}`;
}

// 읽을 수 있는 대상 스페이스가 다른 사용자는 렌더 캐시를 공유하지 않는다.
export function getRenderedPage(args: {
  pageId: string;
  version: number;
  content: string;
  spaceId: string;
  spaceKey: string;
  readable: { key: string; id: string }[];
}) {
  const { pageId, version, content, spaceId, spaceKey } = args;
  const others = linkedSpaces(content, spaceKey, args.readable);
  const cached = unstable_cache(
    async () => renderMarkdown(content, await wikiLinkOptions({ id: spaceId, key: spaceKey }, others)),
    ["page-reading-v2", pageId, String(version), JSON.stringify(others.map(s => [s.key, s.id]))],
    { tags: [pageCacheTag(pageId), spaceLinksTag(spaceId), ...others.map(s => spaceLinksTag(s.id))], revalidate: 60 },
  );
  return cached();
}

/**
 * 페이지 캐시를 즉시 무효화한다. 쓰기/삭제 경로에서 호출한다.
 * 요청 컨텍스트(서버 액션/라우트 핸들러) 밖에서 호출될 경우를 대비해 방어적으로 감싼다
 * (그런 경우에도 60초 TTL이 backstop).
 */
export function invalidatePageCache(pageId: string): void {
  try {
    revalidateTag(pageCacheTag(pageId));
  } catch {
    // 요청 컨텍스트 밖: TTL 만료에 맡긴다.
  }
}
