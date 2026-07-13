"use client";

import { useActionState } from "react";
import { createApiToken, type CreateTokenResult } from "@/actions/tokens";

export function CreateTokenForm() {
  const [state, formAction, pending] = useActionState<CreateTokenResult | null, FormData>(
    createApiToken,
    null,
  );

  return (
    <div>
      <form action={formAction} className="flex flex-wrap items-end gap-3">
        <label className="field min-w-[16rem] flex-1">
          <span>토큰 이름 (예: MCP 서버)</span>
          <input name="name" required placeholder="어디에 쓰는 토큰인지" className="input" />
        </label>
        <button disabled={pending} className="btn btn-primary">
          {pending ? "발급 중..." : "토큰 발급"}
        </button>
      </form>

      {state?.error && (
        <p className="mt-2 text-sm" style={{ color: "var(--danger)" }}>
          {state.error}
        </p>
      )}

      {state?.ok && state.token && (
        <div
          className="mt-4 rounded-[9px] p-4"
          style={{ border: "1px solid var(--accent)", background: "var(--accent-soft)" }}
        >
          <p className="text-sm font-semibold" style={{ color: "var(--ink)" }}>
            새 토큰 &ldquo;{state.name}&rdquo; 발급됨 — 지금 복사하세요. 다시 볼 수 없습니다.
          </p>
          <code
            data-testid="new-token"
            className="mt-2 block overflow-x-auto rounded p-2 text-sm"
            style={{ fontFamily: "var(--font-mono)", background: "var(--surface)", border: "1px solid var(--border)" }}
          >
            {state.token}
          </code>
          <p className="meta mt-2">
            사용: <span style={{ fontFamily: "var(--font-mono)" }}>Authorization: Bearer {state.token.slice(0, 12)}…</span>
          </p>
        </div>
      )}
    </div>
  );
}
