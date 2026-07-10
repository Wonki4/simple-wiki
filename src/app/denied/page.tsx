import Link from "next/link";

export default function DeniedPage() {
  return (
    <main className="py-24 text-center">
      <p className="eyebrow">403</p>
      <h1 className="page-title mt-3">권한이 없습니다</h1>
      <p className="muted mt-3">이 작업을 수행할 권한이 없습니다. 스페이스 관리자에게 문의하세요.</p>
      <Link href="/" className="btn btn-ghost mt-6 inline-flex">
        홈으로
      </Link>
    </main>
  );
}
