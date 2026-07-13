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
          try {
            await toggleLike(spaceKey, slug);
          } catch {
            // 토글 실패가 에러 페이지로 번지지 않게(다음 로드에서 실제 상태로 보정)
          }
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
