// Reuse the reading renderer's complete language set without loading its
// grammars into the editor bundle. Plain code remains usable while loading.
export function createCodeHighlighter(spaceKey: string) {
  const controller = new AbortController();
  const cache = new Map<string, Promise<string | null>>();
  const waiting: (() => void)[] = [];
  let running = 0;
  async function request(code: string, language: string) {
    if (running >= 4) await new Promise<void>(resolve => waiting.push(resolve));
    running++;
    try {
      if (controller.signal.aborted) return null;
      const ticks = [...code.matchAll(/`+/g)].reduce((max, match) => Math.max(max, match[0].length + 1), 3);
      const fence = "`".repeat(ticks);
      const content = `${fence}${language.replace(/[\r\n`]/g, "")}\n${code}${code.endsWith("\n") ? "" : "\n"}${fence}`;
      const response = await fetch(`/api/spaces/${encodeURIComponent(spaceKey)}/preview`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content }), signal: controller.signal,
      });
      if (!response.ok) return null;
      const result = await response.json();
      return typeof result.html === "string" ? result.html as string : null;
    } catch { return null; }
    finally { running--; waiting.shift()?.(); }
  }
  return {
    highlight(code: string, language: string) {
      const key = JSON.stringify([language, code]);
      if (!cache.has(key)) {
        if (cache.size >= 64) cache.delete(cache.keys().next().value!);
        cache.set(key, request(code, language));
      }
      return cache.get(key)!;
    },
    destroy() { controller.abort(); },
  };
}

export type CodeHighlighter = ReturnType<typeof createCodeHighlighter>;
