import { SettingsPage } from "@/components/SettingsPage";
import { SpaceVisibilityField } from "@/components/SpaceVisibilityField";
import { requireSpaceRole } from "@/lib/access";
import { prisma } from "@/lib/db";
import { deleteSpace, removeSpacePermission, updateSpaceVisibility } from "@/actions/spaces";
import { SpacePermissionForm } from "@/components/SpacePermissionForm";
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
  const groupIds = space.permissions.filter(p => p.subjectType === "group").map(p => p.subjectRef);
  const groups = await prisma.wikiGroup.findMany({ where: { id: { in: groupIds } }, select: { id: true, name: true } });
  const groupLabel = new Map(groups.map(g => [g.id, g.name]));

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
        <form action={updateSpaceVisibility.bind(null, spaceKey)} className="settings-visibility-form">
          <SpaceVisibilityField key={space.visibility} defaultValue={space.visibility} labelledBy="visibility-heading" />
          <button className="btn btn-primary mt-3 max-[600px]:w-full">저장</button>
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

        <SpacePermissionForm spaceKey={spaceKey} />
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
