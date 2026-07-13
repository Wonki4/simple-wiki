"use client";

import { useState } from "react";
import Link from "next/link";

interface Item {
  spaceKey: string;
  spaceName: string;
  slug: string;
  title: string;
}

interface Props {
  liked: Item[];
  commented: Item[];
}

export function ActivityTabs({ liked, commented }: Props) {
  const [tab, setTab] = useState<"liked" | "commented">("liked");
  const items = tab === "liked" ? liked : commented;

  return (
    <div className="mt-4">
      <div className="tabs">
        <button
          type="button"
          className={`tab${tab === "liked" ? " tab--active" : ""}`}
          aria-pressed={tab === "liked"}
          onClick={() => setTab("liked")}
        >
          좋아요 <span className="tab__count">{liked.length}</span>
        </button>
        <button
          type="button"
          className={`tab${tab === "commented" ? " tab--active" : ""}`}
          aria-pressed={tab === "commented"}
          onClick={() => setTab("commented")}
        >
          댓글 <span className="tab__count">{commented.length}</span>
        </button>
      </div>

      <ul className="mt-5 grid gap-5">
        {items.map((p) => (
          <li key={`${p.spaceKey}/${p.slug}`}>
            <span className="meta">{p.spaceName}</span>
            <div className="mt-0.5">
              <Link
                href={`/s/${p.spaceKey}/${encodeURIComponent(p.slug)}`}
                className="title-link text-[1.05rem]"
              >
                {p.title}
              </Link>
            </div>
          </li>
        ))}
        {items.length === 0 && (
          <li className="muted">
            {tab === "liked" ? "아직 좋아요한 글이 없습니다." : "아직 댓글 단 글이 없습니다."}
          </li>
        )}
      </ul>
    </div>
  );
}
