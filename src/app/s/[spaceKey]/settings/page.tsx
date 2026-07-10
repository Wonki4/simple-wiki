import { requireSpaceRole } from "@/lib/access";
import { prisma } from "@/lib/db";
import { addSpacePermission, deleteSpace, removeSpacePermission, updateSpaceVisibility } from "@/actions/spaces";
import { ConfirmSubmitButton } from "@/components/ConfirmSubmitButton";

export default async function SpaceSettingsPage({ params }: { params: Promise<{ spaceKey: string }> }) {
  const { spaceKey } = await params;
  const { session, space } = await requireSpaceRole(spaceKey, "admin");

  const userIds = space.permissions.filter((p) => p.subjectType === "user").map((p) => p.subjectRef);
  const users = await prisma.user.findMany({ where: { id: { in: userIds } } });
  const userLabel = new Map(users.map((u) => [u.id, `${u.name} <${u.email}>`]));

  return (
    <main className="py-8">
      <h1 className="text-2xl font-bold">{space.name} 설정</h1>

      <section className="mt-6">
        <h2 className="font-semibold">공개 범위</h2>
        <form action={updateSpaceVisibility.bind(null, spaceKey)} className="mt-2 flex items-center gap-2">
          <select name="visibility" defaultValue={space.visibility} className="rounded border border-gray-300 px-2 py-1 text-sm">
            <option value="organization">전사 공개</option>
            <option value="restricted">제한</option>
          </select>
          <button className="rounded bg-gray-800 px-3 py-1 text-sm text-white">저장</button>
        </form>
      </section>

      <section className="mt-8">
        <h2 className="font-semibold">권한</h2>
        <table className="mt-2 w-full text-sm">
          <thead>
            <tr className="border-b text-left text-gray-500">
              <th className="py-1">유형</th>
              <th>대상</th>
              <th>역할</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {space.permissions.map((p) => (
              <tr key={p.id} className="border-b">
                <td className="py-1">{p.subjectType === "user" ? "사용자" : "그룹"}</td>
                <td>{p.subjectType === "user" ? (userLabel.get(p.subjectRef) ?? p.subjectRef) : p.subjectRef}</td>
                <td>{p.role}</td>
                <td className="text-right">
                  <form action={removeSpacePermission.bind(null, spaceKey, p.id)}>
                    <button className="text-red-600 underline">삭제</button>
                  </form>
                </td>
              </tr>
            ))}
            {space.permissions.length === 0 && (
              <tr>
                <td colSpan={4} className="py-2 text-gray-500">부여된 권한이 없습니다.</td>
              </tr>
            )}
          </tbody>
        </table>

        <form action={addSpacePermission.bind(null, spaceKey)} className="mt-4 flex flex-wrap items-end gap-2 text-sm">
          <label>
            유형
            <select name="subjectType" className="mt-1 block rounded border border-gray-300 px-2 py-1">
              <option value="group">그룹</option>
              <option value="user">사용자(이메일)</option>
            </select>
          </label>
          <label className="flex-1">
            대상 (그룹 경로 또는 이메일)
            <input name="subjectValue" required placeholder="/engineering 또는 alice@example.com" className="mt-1 block w-full rounded border border-gray-300 px-2 py-1" />
          </label>
          <label>
            역할
            <select name="role" className="mt-1 block rounded border border-gray-300 px-2 py-1">
              <option value="viewer">viewer</option>
              <option value="editor">editor</option>
              <option value="admin">admin</option>
            </select>
          </label>
          <button className="rounded bg-blue-600 px-3 py-1.5 text-white">추가</button>
        </form>
      </section>

      {session.isWikiAdmin && (
        <section className="mt-10 border-t border-red-200 pt-4">
          <h2 className="font-semibold text-red-600">위험 구역</h2>
          <p className="mt-1 text-sm text-gray-500">
            스페이스를 삭제하면 모든 페이지, 이력, 권한, 첨부 기록이 함께 삭제됩니다. 되돌릴 수 없습니다.
          </p>
          <form action={deleteSpace.bind(null, spaceKey)} className="mt-2">
            <ConfirmSubmitButton
              message={`정말 "${space.name}" 스페이스를 삭제할까요? 되돌릴 수 없습니다.`}
              className="rounded border border-red-300 px-3 py-1.5 text-sm text-red-600"
            >
              스페이스 삭제
            </ConfirmSubmitButton>
          </form>
        </section>
      )}
    </main>
  );
}
