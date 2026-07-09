"use client";

export default function ErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="py-16 text-center">
      <h1 className="text-xl font-bold">요청을 처리하지 못했습니다</h1>
      <p className="mt-2 text-gray-500">입력값을 확인하고 잠시 후 다시 시도해주세요.</p>
      <button onClick={reset} className="mt-4 rounded bg-gray-800 px-4 py-2 text-sm text-white">
        다시 시도
      </button>
    </main>
  );
}
