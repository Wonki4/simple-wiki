import { requireSpaceRole } from "@/lib/access";
import { prisma } from "@/lib/db";
import { addGroupPermission, addUserPermission, deleteSpace, removeSpacePermission, updateSpaceVisibility } from "@/actions/spaces";
import { ConfirmSubmitButton } from "@/components/ConfirmSubmitButton";

export default async function SpaceSettingsPage({
  params,
  searchParams,
}: {
  params: Promise<{ spaceKey: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { spaceKey } = await params;
  const { error } = await searchParams;
  const { session, space } = await requireSpaceRole(spaceKey, "admin");

  const userIds = space.permissions.filter((p) => p.subjectType === "user").map((p) => p.subjectRef);
  const users = await prisma.user.findMany({ where: { id: { in: userIds } } });
  const userLabel = new Map(users.map((u) => [u.id, `${u.name} <${u.email}>`]));
  const allGroups = await prisma.wikiGroup.findMany({ orderBy: { name: "asc" } });
  const groupLabel = new Map(allGroups.map((g) => [g.id, g.name]));

  const subjectLabel = (p: { subjectType: string; subjectRef: string }) =>
    p.subjectType === "user"
      ? (userLabel.get(p.subjectRef) ?? p.subjectRef)
      : (groupLabel.get(p.subjectRef) ?? p.subjectRef);

  return (
    <main className="py-10">
      <p className="eyebrow">{space.key} · settings</p>
      <h1 className="page-title mt-1">{space.name} 설정</h1>

      {error && (
        <div className="notice notice-warn mt-4" role="alert">
          {error}
        </div>
      )}

      <section className="mt-8">
        <h2 className="section-title">공개 범위</h2>
        <form action={updateSpaceVisibility.bind(null, spaceKey)} className="mt-3 flex items-center gap-2">
          <select name="visibility" defaultValue={space.visibility} className="select w-auto">
            <option value="organization">전사 공개</option>
            <option value="restricted">제한</option>
          </select>
          <button className="btn btn-primary btn-sm">저장</button>
        </form>
      </section>

      <section className="mt-10">
        <h2 className="section-title">권한</h2>
        <div className="mt-3 overflow-x-auto">
          <table className="dtable">
            <thead>
              <tr>
                <th>유형</th>
                <th>대상</th>
                <th>역할</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {space.permissions.map((p) => (
                <tr key={p.id}>
                  <td>{p.subjectType === "user" ? "사용자" : "그룹"}</td>
                  <td>
                    <span className="key">{subjectLabel(p)}</span>
                  </td>
                  <td>{p.role}</td>
                  <td className="text-right">
                    <form action={removeSpacePermission.bind(null, spaceKey, p.id)}>
                      <ConfirmSubmitButton
                        message={`"${subjectLabel(p)}"의 ${p.role} 권한을 삭제할까요?`}
                        className="btn btn-danger btn-sm"
                      >
                        삭제
                      </ConfirmSubmitButton>
                    </form>
                  </td>
                </tr>
              ))}
              {space.permissions.length === 0 && (
                <tr>
                  <td colSpan={4} className="muted">부여된 권한이 없습니다.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <form action={addGroupPermission.bind(null, spaceKey)} className="mt-5 flex flex-wrap items-end gap-3">
          <label className="field min-w-[16rem]">
            <span>그룹</span>
            <select name="groupId" required className="select" disabled={allGroups.length === 0}>
              {allGroups.map((g) => (
                <option key={g.id} value={g.id}>{g.name}</option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>역할</span>
            <select name="role" className="select w-auto">
              <option value="viewer">viewer</option>
              <option value="editor">editor</option>
              <option value="admin">admin</option>
            </select>
          </label>
          <button className="btn btn-primary" disabled={allGroups.length === 0}>그룹 권한 추가</button>
          {allGroups.length === 0 && (
            <span className="muted text-sm">그룹이 없습니다. 전역 관리자가 그룹 관리에서 먼저 만들어야 합니다.</span>
          )}
        </form>

        <form action={addUserPermission.bind(null, spaceKey)} className="mt-3 flex flex-wrap items-end gap-3">
          <label className="field min-w-[16rem] flex-1">
            <span>사용자 (이메일 또는 아이디)</span>
            <input name="email" type="text" required placeholder="alice@example.com 또는 alice" className="input" />
          </label>
          <label className="field">
            <span>역할</span>
            <select name="role" className="select w-auto">
              <option value="viewer">viewer</option>
              <option value="editor">editor</option>
              <option value="admin">admin</option>
            </select>
          </label>
          <button className="btn btn-primary">사용자 권한 추가</button>
        </form>
      </section>

      {session.isWikiAdmin && (
        <section
          className="mt-12 rounded-[9px] p-5"
          style={{ border: "1px solid var(--danger-border)", background: "color-mix(in srgb, var(--danger) 4%, transparent)" }}
        >
          <h2 className="section-title" style={{ color: "var(--danger)" }}>위험 구역</h2>
          <p className="muted mt-1.5 text-sm">
            스페이스를 삭제하면 모든 페이지, 이력, 권한, 첨부 기록이 함께 삭제됩니다. 되돌릴 수 없습니다.
          </p>
          <form action={deleteSpace.bind(null, spaceKey)} className="mt-3">
            <ConfirmSubmitButton
              message={`정말 "${space.name}" 스페이스를 삭제할까요? 되돌릴 수 없습니다.`}
              className="btn btn-danger btn-sm"
            >
              스페이스 삭제
            </ConfirmSubmitButton>
          </form>
        </section>
      )}
    </main>
  );
}
