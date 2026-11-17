import Link from "next/link";
import { SettingsPage } from "@/components/SettingsPage";
import { requireSpaceRole } from "@/lib/access";
import { prisma } from "@/lib/db";
import { addGroupPermission, addUserPermission, deleteSpace, removeSpacePermission, updateSpaceVisibility } from "@/actions/spaces";
import { ConfirmSubmitButton } from "@/components/ConfirmSubmitButton";

const roleLabels = { viewer: "읽기", editor: "편집", admin: "관리" };

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
  const userLabel = new Map(users.map((u) => [u.id, [u.name, u.email].filter(Boolean).join(" · ")]));
  const allGroups = await prisma.wikiGroup.findMany({ orderBy: { name: "asc" } });
  const groupLabel = new Map(allGroups.map((g) => [g.id, g.name]));

  const subjectLabel = (p: { subjectType: string; subjectRef: string }) =>
    p.subjectType === "user"
      ? (userLabel.get(p.subjectRef) ?? p.subjectRef)
      : (groupLabel.get(p.subjectRef) ?? p.subjectRef);

  return (
    <SettingsPage section="space" title={`${space.name} 설정`} space={space} isWikiAdmin={session.isWikiAdmin}>

      {error && (
        <div className="notice notice-warn mt-4" role="alert">
          {error}
        </div>
      )}

      <section className="settings-section" aria-labelledby="visibility-heading">
        <h2 id="visibility-heading" className="section-title">공개 범위</h2>
        <p id="visibility-help" className="settings-help">
          전사 공개는 로그인한 모든 사용자가 읽을 수 있습니다. 제한된 스페이스는 권한을 부여한 사용자·그룹과 전역 관리자가 접근할 수 있습니다.
        </p>
        <form action={updateSpaceVisibility.bind(null, spaceKey)} className="settings-form settings-visibility-form">
          <select name="visibility" aria-label="공개 범위" aria-describedby="visibility-help" defaultValue={space.visibility} className="select">
            <option value="organization">전사 공개</option>
            <option value="restricted">제한</option>
          </select>
          <button className="btn btn-primary">저장</button>
        </form>
      </section>

      <section className="settings-section" aria-labelledby="permissions-heading">
        <h2 id="permissions-heading" className="section-title">권한</h2>
        <p id="role-help" className="settings-help">읽기는 문서 열람, 편집은 문서 작성·수정·휴지통 관리, 관리는 공개 범위와 권한 설정까지 허용합니다.</p>
        <div className="settings-table-wrap">
          <table className="dtable settings-table">
            <thead>
              <tr>
                <th>유형</th>
                <th>대상</th>
                <th>역할</th>
                <th><span className="sr-only">작업</span></th>
              </tr>
            </thead>
            <tbody>
              {space.permissions.map((p) => (
                <tr key={p.id}>
                  <td data-label="유형">{p.subjectType === "user" ? "사용자" : "그룹"}</td>
                  <td data-label="대상">{subjectLabel(p)}</td>
                  <td data-label="역할"><span className="settings-role">{roleLabels[p.role]}</span></td>
                  <td className="settings-row-actions">
                    <form action={removeSpacePermission.bind(null, spaceKey, p.id)}>
                      <ConfirmSubmitButton
                        message={`"${subjectLabel(p)}"의 ${roleLabels[p.role]} 권한을 삭제할까요?`}
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

        <form action={addGroupPermission.bind(null, spaceKey)} aria-label="그룹 권한 추가" className="settings-form settings-permission-form">
          <label className="field">
            <span>그룹</span>
            <select name="groupId" required defaultValue="" className="select" disabled={allGroups.length === 0}>
              <option value="" disabled>{allGroups.length ? "그룹 선택" : "등록된 그룹 없음"}</option>
              {allGroups.map((g) => (
                <option key={g.id} value={g.id}>{g.name}</option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>역할</span>
            <select name="role" className="select" aria-describedby="role-help">
              {Object.entries(roleLabels).map(([role, label]) => <option key={role} value={role}>{label}</option>)}
            </select>
          </label>
          <button className="btn btn-primary" disabled={allGroups.length === 0}>그룹 권한 추가</button>
        </form>
        {allGroups.length === 0 && (
          <p className="settings-help">
            {session.isWikiAdmin
              ? <>그룹을 먼저 만들어 주세요. <Link className="linklike" href="/groups">그룹 관리로 이동</Link></>
              : "전역 관리자에게 그룹 생성을 요청하세요."}
          </p>
        )}

        <form action={addUserPermission.bind(null, spaceKey)} aria-label="사용자 권한 추가" className="settings-form settings-permission-form">
          <label className="field">
            <span>사용자 (이메일 또는 아이디)</span>
            <input name="email" type="text" required placeholder="alice@example.com 또는 alice" className="input" />
          </label>
          <label className="field">
            <span>역할</span>
            <select name="role" className="select" aria-describedby="role-help">
              {Object.entries(roleLabels).map(([role, label]) => <option key={role} value={role}>{label}</option>)}
            </select>
          </label>
          <button className="btn btn-primary">사용자 권한 추가</button>
        </form>
      </section>

      {session.isWikiAdmin && (
        <section className="settings-danger">
          <h2 className="section-title">스페이스 삭제</h2>
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
    </SettingsPage>
  );
}
