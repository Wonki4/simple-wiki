import Link from "next/link";

export default function NotFound() {
  return (
    <main className="wrap py-24 text-center">
      <p className="eyebrow">404</p>
      <h1 className="page-title mt-3">페이지를 찾을 수 없습니다</h1>
      <Link href="/" className="btn btn-ghost mt-6 inline-flex">
        홈으로
      </Link>
    </main>
  );
}
