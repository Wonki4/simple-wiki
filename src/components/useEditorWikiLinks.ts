import { useContext, useEffect, useMemo, useState } from "react";
import { SpacePagesContext } from "./SpacePagesContext";
import { extractWikiLinks, splitWikiTarget, type WikiLinkOptions } from "@/lib/wiki-links";
import { slugify } from "@/lib/slug";
import type { LinkPage } from "@/lib/wiki-link-completion";

export function useEditorWikiLinks(spaceKey: string, content: string): WikiLinkOptions {
  const { pages, spaces } = useContext(SpacePagesContext);
  const destinations = useMemo(() => {
    const names = new Map(pages.map(page => [page.slug, page.slug]));
    for (const page of pages) if (!names.has(slugify(page.title))) names.set(slugify(page.title), page.slug);
    return names;
  }, [pages]);
  const [requests, setRequests] = useState("[]");
  useEffect(() => {
    const timer = window.setTimeout(() => setRequests(JSON.stringify([...new Set(extractWikiLinks(content)
      .filter(link => link.space && link.space !== spaceKey && spaces.some(space => space.key === link.space))
      .map(link => JSON.stringify([link.space, splitWikiTarget(link.target).name])))].sort())), 250);
    return () => clearTimeout(timer);
  }, [content, spaceKey, spaces]);
  const [resolved, setResolved] = useState<{ requests: string; spaces: Map<string, Map<string, string>> }>();
  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      const otherSpaces = new Map<string, Map<string, string>>();
      const queue = JSON.parse(requests) as string[];
      await Promise.all(Array.from({ length: Math.min(4, queue.length) }, async () => {
        while (queue.length && !controller.signal.aborted) {
          const [space, name] = JSON.parse(queue.shift()!) as [string, string];
          try {
            const res = await fetch(`/api/spaces/${encodeURIComponent(space)}/wiki-links?q=${encodeURIComponent(name)}`, { signal: controller.signal });
            if (!res.ok) continue;
            const matches: LinkPage[] = await res.json();
            if (!otherSpaces.has(space)) otherSpaces.set(space, new Map());
            const names = otherSpaces.get(space)!;
            for (const page of matches) names.set(page.slug, page.slug);
            for (const page of matches) if (!names.has(slugify(page.title))) names.set(slugify(page.title), page.slug);
          } catch { /* Keep inaccessible or unavailable destinations as plain text. */ }
        }
      }));
      if (!controller.signal.aborted) setResolved({ requests, spaces: otherSpaces });
    }, 250);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [requests]);
  return useMemo(() => ({ spaceKey, destinations,
    otherSpaces: resolved?.requests === requests ? resolved.spaces : undefined,
  }), [spaceKey, destinations, resolved, requests]);
}
