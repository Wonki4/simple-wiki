import { redirect } from "next/navigation";
import { listReadableSpaces, requireSession } from "@/lib/access";
import { prisma } from "@/lib/db";
import { addGroupMember, createGroup, deleteGroup, removeGroupMember } from "@/actions/groups";
import { SettingsPage } from "@/components/SettingsPage";
import { WikiShell } from "@/components/WikiShell";
import { ConfirmSubmitButton } from "@/components/ConfirmSubmitButton";

export default async function GroupsPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const session = await requireSession();
  if (!session.isWikiAdmin) redirect("/denied");
  const { error } = await searchParams;
  const spaces = await listReadableSpaces(session);

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
    <WikiShell session={session} spaces={spaces}>
      <SettingsPage section="groups" title="그룹 관리" isWikiAdmin={session.isWikiAdmin}
        description="스페이스 권한을 함께 부여할 사람들을 그룹으로 관리합니다. 멤버 변경은 즉시 반영됩니다.">

        {error && (
          <div className="notice notice-warn mt-4" role="alert">
            {error}
          </div>
        )}

        <form action={createGroup} className="settings-form settings-group-create">
          <label className="field">
            <span>새 그룹 이름</span>
            <input name="name" required placeholder="engineering" className="input" />
          </label>
          <button className="btn btn-primary">그룹 만들기</button>
        </form>

        {groups.length === 0 && <p className="muted mt-8">아직 그룹이 없습니다.</p>}

        {groups.map((g) => (
          <section key={g.id} className="settings-group" aria-labelledby={`group-${g.id}`}>
            <div className="settings-section-heading">
              <div>
                <h2 id={`group-${g.id}`} className="section-title">{g.name}</h2>
                <p className="settings-help">
                  멤버 {g.members.length}명 · 스페이스 연결 {linkCount.get(g.id) ?? 0}건
                </p>
              </div>
              <form action={deleteGroup.bind(null, g.id)}>
                <ConfirmSubmitButton
                  message={`"${g.name}" 그룹을 삭제할까요? 연결된 스페이스 권한 ${linkCount.get(g.id) ?? 0}건도 함께 삭제됩니다.`}
                  className="btn btn-danger btn-sm"
                >
                  그룹 삭제
                </ConfirmSubmitButton>
              </form>
            </div>

            <div className="settings-table-wrap">
              <table className="dtable settings-table">
                <thead>
                  <tr>
                    <th>이름</th>
                    <th>이메일</th>
                    <th><span className="sr-only">작업</span></th>
                  </tr>
                </thead>
                <tbody>
                  {g.members.map((m) => (
                    <tr key={m.id}>
                      <td data-label="이름">{m.user.name}</td>
                      <td data-label="이메일">{m.user.email}</td>
                      <td className="settings-row-actions">
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

            <form action={addGroupMember.bind(null, g.id)} className="settings-form settings-member-form">
              <label className="field">
                <span>멤버 추가 (이메일 또는 아이디)</span>
                <input name="email" type="text" required placeholder="alice@example.com 또는 alice" className="input" aria-describedby={`member-help-${g.id}`} />
              </label>
              <button className="btn btn-primary btn-sm">멤버 추가</button>
            </form>
            <p id={`member-help-${g.id}`} className="settings-help">위키에 한 번 이상 로그인한 사용자를 추가할 수 있습니다.</p>
          </section>
        ))}
      </SettingsPage>
    </WikiShell>
  );
}
