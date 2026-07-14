import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionInfo, listReadableSpaces } from "@/lib/access";

export default async function Home() {
  const session = await getSessionInfo();
  if (!session) {
    return (
      <main className="wrap py-20 text-center">
        <p className="eyebrow">simple-wiki</p>
        <h1 className="page-title mt-3">조직의 지식을 한곳에</h1>
        <p className="muted mt-3">상단의 로그인 버튼으로 시작하세요.</p>
      </main>
    );
  }

  const spaces = await listReadableSpaces(session);
  if (spaces.length === 0) {
    // 전역 관리자에게는 막다른 화면 대신 첫 스페이스 생성 진입점을 준다.
    return (
      <main className="wrap py-20 text-center">
        <h1 className="page-title">스페이스가 없습니다</h1>
        {session.isWikiAdmin ? (
          <>
            <p className="muted mt-3">첫 스페이스를 만들어 시작하세요.</p>
            <Link href="/spaces/new" className="btn btn-primary mt-6 inline-flex">
              새 스페이스 만들기
            </Link>
          </>
        ) : (
          <p className="muted mt-3">접근 가능한 스페이스가 없습니다. 관리자에게 문의하세요.</p>
        )}
      </main>
    );
  }

  // 접속 시 공지사항 스페이스로 랜딩(없으면 첫 스페이스)
  const landing = spaces.find((s) => s.key === "notice") ?? spaces[0];
  redirect(`/s/${landing.key}`);
}
