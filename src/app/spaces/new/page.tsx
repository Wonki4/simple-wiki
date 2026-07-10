import { redirect } from "next/navigation";
import { requireSession } from "@/lib/access";
import { createSpace } from "@/actions/spaces";

export default async function NewSpacePage() {
  const session = await requireSession();
  if (!session.isWikiAdmin) redirect("/denied");
  return (
    <main className="py-10">
      <p className="eyebrow">new workspace</p>
      <h1 className="page-title mt-1">새 스페이스</h1>
      <form action={createSpace} className="mt-7 grid max-w-md gap-4">
        <label className="field">
          <span>키 (URL용, 소문자/숫자/하이픈)</span>
          <input name="key" required pattern="[a-z0-9][a-z0-9-]{1,31}" className="input" style={{ fontFamily: "var(--font-mono)" }} />
        </label>
        <label className="field">
          <span>이름</span>
          <input name="name" required className="input" />
        </label>
        <label className="field">
          <span>설명</span>
          <input name="description" className="input" />
        </label>
        <label className="field">
          <span>공개 범위</span>
          <select name="visibility" className="select">
            <option value="organization">전사 공개 (로그인 사용자 모두 읽기)</option>
            <option value="restricted">제한 (권한 부여된 대상만)</option>
          </select>
        </label>
        <div>
          <button className="btn btn-primary">만들기</button>
        </div>
      </form>
    </main>
  );
}
