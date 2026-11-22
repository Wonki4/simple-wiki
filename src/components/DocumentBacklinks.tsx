"use client";

import { useId, useState } from "react";
import { NavigationLink as Link } from "./NavigationLink";

interface Backlink {
  title: string;
  slug: string;
  spaceKey: string;
}

const PREVIEW_COUNT = 5;

export function DocumentBacklinks({ backlinks, spaceKey }: { backlinks: Backlink[]; spaceKey: string }) {
  const [expanded, setExpanded] = useState(false);
  const listId = useId();
  if (!backlinks.length) return null;
  const visible = expanded ? backlinks : backlinks.slice(0, PREVIEW_COUNT);

  return (
    <aside className="document-backlinks" aria-labelledby={`${listId}-heading`}>
      <h2 id={`${listId}-heading`} className="eyebrow">
        이 페이지를 링크한 문서 <span className="backlinks__count">{backlinks.length}</span>
      </h2>
      <ul id={listId} className={`backlinks__list${expanded ? " is-expanded" : ""}`}>
        {visible.map(link => {
          const label = link.spaceKey === spaceKey ? link.title : `${link.spaceKey} · ${link.title}`;
          return <li key={`${link.spaceKey}/${link.slug}`}>
            <Link href={`/s/${link.spaceKey}/${encodeURIComponent(link.slug)}`} title={label}>{label}</Link>
          </li>;
        })}
      </ul>
      {backlinks.length > PREVIEW_COUNT && (
        <button type="button" className="backlinks__toggle" aria-expanded={expanded} aria-controls={listId}
          onClick={() => setExpanded(value => !value)}>
          {expanded ? "접기" : `${backlinks.length - PREVIEW_COUNT}개 더 보기`}
          <svg aria-hidden="true" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="m4 6 4 4 4-4" />
          </svg>
        </button>
      )}
    </aside>
  );
}
