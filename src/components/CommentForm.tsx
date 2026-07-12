"use client";

import { useRef } from "react";
import { addComment } from "@/actions/comments";

export function CommentForm({ spaceKey, slug }: { spaceKey: string; slug: string }) {
  const formRef = useRef<HTMLFormElement>(null);

  return (
    <form
      ref={formRef}
      action={async (fd) => {
        await addComment(spaceKey, slug, fd);
        formRef.current?.reset();
      }}
      className="comment-form"
    >
      <textarea
        name="body"
        required
        rows={3}
        maxLength={5000}
        placeholder="댓글을 남겨보세요"
        className="input comment-form__input"
      />
      <div className="comment-form__actions">
        <button className="btn btn-primary btn-sm">댓글 작성</button>
      </div>
    </form>
  );
}
