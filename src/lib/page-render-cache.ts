import { unstable_cache, revalidateTag } from "next/cache";
import { getWikiDestinations, spaceLinksTag } from "./wiki-link-destinations";
import { renderMarkdown } from "@/lib/markdown";

export function pageCacheTag(pageId: string): string {
  return `page:${pageId}`;
}

/**
 * 페이지 본문 렌더(HTML)를 캐시한다.
 * 키 = (pageId, version): version은 불변이므로 편집 시 자연 미스된다.
 * TTL 60초: 다중 replica 로컬 캐시 staleness 상한 + 위키링크 해석(다른 페이지
 * 생성/삭제)의 cross-page staleness 상한. 편집 replica는 revalidateTag로 즉시 무효화한다.
 * 권한 판정은 이 함수 밖에서 매 요청 수행한다(여기엔 권한 로직이 없다).
 */
export function getRenderedPage(args: {
  pageId: string;
  version: number;
  content: string;
  spaceId: string;
  spaceKey: string;
}) {
  const { pageId, version, content, spaceId, spaceKey } = args;
  const cached = unstable_cache(
    async () => renderMarkdown(content, { spaceKey, destinations: await getWikiDestinations(spaceId) }),
    ["page-reading-v1", pageId, String(version)],
    { tags: [pageCacheTag(pageId), spaceLinksTag(spaceId)], revalidate: 60 },
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
