import Link from "next/link";
import { getSessionInfo, listReadableSpaces } from "@/lib/access";

export default async function Home() {
  const session = await getSessionInfo();
  if (!session) {
    return (
      <main className="py-20 text-center">
        <p className="eyebrow">simple-wiki</p>
        <h1 className="page-title mt-3">조직의 지식을 한곳에</h1>
        <p className="muted mt-3">상단의 로그인 버튼으로 시작하세요.</p>
      </main>
    );
  }
  const spaces = await listReadableSpaces(session);
  return (
    <main className="py-10">
      <div className="flex items-end justify-between gap-4">
        <div>
          <p className="eyebrow">workspace</p>
          <h1 className="page-title mt-1">스페이스</h1>
        </div>
        {session.isWikiAdmin && (
          <Link href="/spaces/new" className="btn btn-primary">
            새 스페이스
          </Link>
        )}
      </div>

      <ul className="mt-7 grid gap-3">
        {spaces.map((s) => (
          <li key={s.id}>
            <Link href={`/s/${s.key}`} className="card card-link">
              <div className="flex items-center gap-2.5">
                <span className="key">{s.key}</span>
                <span className="title-link text-[1.02rem]">{s.name}</span>
                <span className={`badge${s.visibility === "restricted" ? " badge-restricted" : ""}`}>
                  {s.visibility === "restricted" ? "제한" : "전사 공개"}
                </span>
              </div>
              {s.description && <p className="muted mt-1.5 text-sm">{s.description}</p>}
            </Link>
          </li>
        ))}
        {spaces.length === 0 && (
          <li className="card muted text-sm">접근 가능한 스페이스가 없습니다.</li>
        )}
      </ul>
    </main>
  );
}
