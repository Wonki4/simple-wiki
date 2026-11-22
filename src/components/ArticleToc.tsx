import type { Section } from "@/lib/reading-markup";
import { Disclosure } from "@/components/Disclosure";

export function ArticleToc({ sections, compact = false }: { sections: Section[]; compact?: boolean }) {
  if (sections.length < 2) return null;
  const topDepth = sections.reduce((depth, section) => Math.min(depth, section.depth), 6);
  const links = (
    <ul>
      {sections.map(({ id, title, depth }) => (
        <li key={id} style={{ paddingInlineStart: `${(depth - topDepth) * 0.8}rem` }}>
          <a href={`#${id}`}>{title}</a>
        </li>
      ))}
    </ul>
  );

  return (
    <nav aria-label="문서 목차" className={`article-toc article-toc--${compact ? "compact" : "rail"}`}>
      {compact ? (
        <Disclosure label="목차" trigger={<>
          목차
          <svg aria-hidden="true" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="m4 6 4 4 4-4" />
          </svg>
        </>}>
          {links}
        </Disclosure>
      ) : <><p className="article-toc__title">목차</p>{links}</>}
    </nav>
  );
}
