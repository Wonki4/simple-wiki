"use client";

export default function ErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="wrap py-24 text-center">
      <p className="eyebrow">error</p>
      <h1 className="page-title mt-3">요청을 처리하지 못했습니다</h1>
      <p className="muted mt-3">입력값을 확인하고 잠시 후 다시 시도해주세요.</p>
      <button onClick={reset} className="btn btn-primary mt-6">
        다시 시도
      </button>
    </main>
  );
}
