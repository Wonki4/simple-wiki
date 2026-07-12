"use client";

import { useOptimistic, useTransition } from "react";
import { toggleLike } from "@/actions/likes";

interface Props {
  spaceKey: string;
  slug: string;
  count: number;
  liked: boolean;
}

export function LikeButton({ spaceKey, slug, count, liked }: Props) {
  const [state, setOptimistic] = useOptimistic(
    { count, liked },
    (prev, nextLiked: boolean) => ({
      liked: nextLiked,
      count: prev.count + (nextLiked ? 1 : -1),
    }),
  );
  const [pending, startTransition] = useTransition();

  return (
    <button
      type="button"
      className={`like-btn${state.liked ? " like-btn--on" : ""}`}
      aria-pressed={state.liked}
      aria-label={state.liked ? "좋아요 취소" : "좋아요"}
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          setOptimistic(!state.liked);
          await toggleLike(spaceKey, slug);
        })
      }
    >
      <span className="like-btn__icon" aria-hidden="true">
        {state.liked ? "♥" : "♡"}
      </span>
      <span className="like-btn__count">{state.count}</span>
    </button>
  );
}
