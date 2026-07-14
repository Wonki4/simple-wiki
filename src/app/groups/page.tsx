import { redirect } from "next/navigation";
import { requireSession } from "@/lib/access";
import { prisma } from "@/lib/db";
import { addGroupMember, createGroup, deleteGroup, removeGroupMember } from "@/actions/groups";
import { ConfirmSubmitButton } from "@/components/ConfirmSubmitButton";

export default async function GroupsPage() {
  const session = await requireSession();
  if (!session.isWikiAdmin) redirect("/denied");

  const groups = await prisma.wikiGroup.findMany({
    orderBy: { name: "asc" },
    include: { members: { include: { user: true }, orderBy: { user: { name: "asc" } } } },
  });
  // 그룹별로 연결된 스페이스 권한 수 — 삭제 경고에 쓴다.
  const linkRows = await prisma.spacePermission.groupBy({
    by: ["subjectRef"],
    where: { subjectType: "group" },
    _count: true,
  });
  const linkCount = new Map(linkRows.map((r) => [r.subjectRef, r._count]));

  return (
    <main className="py-10">
      <p className="eyebrow">admin · groups</p>
      <h1 className="page-title mt-1">그룹 관리</h1>
      <p className="muted mt-2 text-sm">
        스페이스 권한에 연결하는 위키 그룹입니다. 멤버 변경은 재로그인 없이 즉시 반영됩니다.
      </p>

      <form action={createGroup} className="mt-6 flex items-end gap-3">
        <label className="field min-w-[16rem]">
          <span>새 그룹 이름</span>
          <input name="name" required placeholder="engineering" className="input" />
        </label>
        <button className="btn btn-primary">그룹 만들기</button>
      </form>

      {groups.length === 0 && <p className="muted mt-8">아직 그룹이 없습니다.</p>}

      {groups.map((g) => (
        <section key={g.id} className="mt-10">
          <div className="flex items-center gap-3">
            <h2 className="section-title">{g.name}</h2>
            <span className="muted text-sm">
              멤버 {g.members.length}명 · 스페이스 연결 {linkCount.get(g.id) ?? 0}건
            </span>
            <form action={deleteGroup.bind(null, g.id)} className="ml-auto">
              <ConfirmSubmitButton
                message={`"${g.name}" 그룹을 삭제할까요? 연결된 스페이스 권한 ${linkCount.get(g.id) ?? 0}건도 함께 삭제됩니다.`}
                className="btn btn-danger btn-sm"
              >
                그룹 삭제
              </ConfirmSubmitButton>
            </form>
          </div>

          <div className="mt-3 overflow-x-auto">
            <table className="dtable">
              <thead>
                <tr>
                  <th>이름</th>
                  <th>이메일</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {g.members.map((m) => (
                  <tr key={m.id}>
                    <td>{m.user.name}</td>
                    <td><span className="key">{m.user.email}</span></td>
                    <td className="text-right">
                      <form action={removeGroupMember.bind(null, m.id)}>
                        <ConfirmSubmitButton
                          message={`"${m.user.name}"을(를) ${g.name} 그룹에서 제거할까요?`}
                          className="btn btn-danger btn-sm"
                        >
                          제거
                        </ConfirmSubmitButton>
                      </form>
                    </td>
                  </tr>
                ))}
                {g.members.length === 0 && (
                  <tr>
                    <td colSpan={3} className="muted">멤버가 없습니다.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <form action={addGroupMember.bind(null, g.id)} className="mt-4 flex items-end gap-3">
            <label className="field min-w-[16rem]">
              <span>멤버 추가 (이메일 — 로그인 이력이 있어야 합니다)</span>
              <input name="email" type="email" required placeholder="alice@example.com" className="input" />
            </label>
            <button className="btn btn-primary btn-sm">멤버 추가</button>
          </form>
        </section>
      ))}
    </main>
  );
}
