import { redirect } from "next/navigation";
import { requireSession } from "@/lib/access";
import { createSpace } from "@/actions/spaces";

export default async function NewSpacePage() {
  const session = await requireSession();
  if (!session.isWikiAdmin) redirect("/denied");
  return (
    <main className="py-8">
      <h1 className="text-2xl font-bold">새 스페이스</h1>
      <form action={createSpace} className="mt-6 max-w-md space-y-4">
        <label className="block text-sm">
          키 (URL용, 소문자/숫자/하이픈)
          <input name="key" required pattern="[a-z0-9][a-z0-9-]{1,31}" className="mt-1 w-full rounded border border-gray-300 px-2 py-1" />
        </label>
        <label className="block text-sm">
          이름
          <input name="name" required className="mt-1 w-full rounded border border-gray-300 px-2 py-1" />
        </label>
        <label className="block text-sm">
          설명
          <input name="description" className="mt-1 w-full rounded border border-gray-300 px-2 py-1" />
        </label>
        <label className="block text-sm">
          공개 범위
          <select name="visibility" className="mt-1 w-full rounded border border-gray-300 px-2 py-1">
            <option value="organization">전사 공개 (로그인 사용자 모두 읽기)</option>
            <option value="restricted">제한 (권한 부여된 대상만)</option>
          </select>
        </label>
        <button className="rounded bg-blue-600 px-4 py-2 text-sm text-white">만들기</button>
      </form>
    </main>
  );
}
