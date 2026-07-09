import Link from "next/link";
import { getSessionInfo, listReadableSpaces } from "@/lib/access";

export default async function Home() {
  const session = await getSessionInfo();
  if (!session) {
    return (
      <main className="py-16 text-center text-gray-500">
        상단의 로그인 버튼으로 시작하세요.
      </main>
    );
  }
  const spaces = await listReadableSpaces(session);
  return (
    <main className="py-8">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">스페이스</h1>
        {session.isWikiAdmin && (
          <Link href="/spaces/new" className="rounded bg-blue-600 px-3 py-1.5 text-sm text-white">
            새 스페이스
          </Link>
        )}
      </div>
      <ul className="mt-6 space-y-2">
        {spaces.map((s) => (
          <li key={s.id} className="rounded border border-gray-200 p-4">
            <Link href={`/s/${s.key}`} className="font-semibold text-blue-600 underline">
              {s.name}
            </Link>
            <span className="ml-2 text-xs text-gray-400">
              {s.visibility === "restricted" ? "제한" : "전사 공개"}
            </span>
            {s.description && <p className="mt-1 text-sm text-gray-500">{s.description}</p>}
          </li>
        ))}
        {spaces.length === 0 && <li className="text-gray-500">접근 가능한 스페이스가 없습니다.</li>}
      </ul>
    </main>
  );
}
