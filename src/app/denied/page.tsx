import Link from "next/link";

export default function DeniedPage() {
  return (
    <main className="py-16 text-center">
      <h1 className="text-xl font-bold">권한이 없습니다</h1>
      <p className="mt-2 text-gray-500">이 작업을 수행할 권한이 없습니다. 스페이스 관리자에게 문의하세요.</p>
      <Link href="/" className="mt-4 inline-block underline">
        홈으로
      </Link>
    </main>
  );
}
