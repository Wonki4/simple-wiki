import { listReadableSpaces, requireSession } from "@/lib/access";
import { prisma } from "@/lib/db";
import { revokeApiToken } from "@/actions/tokens";
import { CreateTokenForm } from "@/components/CreateTokenForm";
import { ConfirmSubmitButton } from "@/components/ConfirmSubmitButton";

export default async function TokensPage() {
  const session = await requireSession();
  const [tokens, spaces] = await Promise.all([
    prisma.apiToken.findMany({ where: { userId: session.userId }, orderBy: { createdAt: "desc" },
      select: { id: true, name: true, prefix: true, lastUsedAt: true, createdAt: true, readOnly: true, spaceId: true } }),
    listReadableSpaces(session),
  ]);
  const spaceNames = new Map(spaces.map(space => [space.id, space.name]));

  return (
    <main className="wrap py-10">
      <p className="eyebrow">settings · api</p>
      <h1 className="page-title mt-1">개인 액세스 토큰</h1>
      <p className="muted mt-2 max-w-2xl text-sm">
        MCP와 API에서 사용할 토큰입니다. 읽기 전용이나 특정 스페이스로 제한할 수 있습니다.
        읽기·쓰기를 선택해도 문서를 수정하려면 해당 스페이스의 편집 권한이 필요합니다.
      </p>

      <section className="mt-8">
        <h2 className="section-title">새 토큰 발급</h2>
        <div className="mt-3">
          <CreateTokenForm spaces={spaces.map(({ id, key, name }) => ({ id, key, name }))} />
        </div>
      </section>

      <section className="mt-10">
        <h2 className="section-title">발급된 토큰</h2>
        <div className="mt-3 overflow-x-auto">
          <table className="dtable">
            <thead>
              <tr>
                <th>이름</th>
                <th>권한</th>
                <th>스페이스</th>
                <th>접두사</th>
                <th>마지막 사용</th>
                <th>발급일</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {tokens.map((t) => (
                <tr key={t.id}>
                  <td>{t.name}</td>
                  <td>{t.readOnly ? "읽기 전용" : "읽기·쓰기"}</td>
                  <td>{t.spaceId ? spaceNames.get(t.spaceId) ?? "접근 권한 없음" : "전체"}</td>
                  <td>
                    <span className="key">{t.prefix}…</span>
                  </td>
                  <td>{t.lastUsedAt ? t.lastUsedAt.toISOString().slice(0, 16).replace("T", " ") : "—"}</td>
                  <td>{t.createdAt.toISOString().slice(0, 10)}</td>
                  <td className="text-right">
                    <form action={revokeApiToken.bind(null, t.id)}>
                      <ConfirmSubmitButton
                        message={`"${t.name}" 토큰을 삭제할까요? 이 토큰을 쓰는 연동이 즉시 끊깁니다.`}
                        className="btn btn-danger btn-sm"
                      >
                        삭제
                      </ConfirmSubmitButton>
                    </form>
                  </td>
                </tr>
              ))}
              {tokens.length === 0 && (
                <tr>
                  <td colSpan={7} className="muted">발급된 토큰이 없습니다.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="mt-10">
        <h2 className="section-title">호출 예시</h2>
        <pre
          className="mt-3 overflow-x-auto rounded-[9px] p-4 text-sm"
          style={{ fontFamily: "var(--font-mono)", background: "var(--surface-2)", border: "1px solid var(--border)" }}
        >{`# 읽기 가능한 스페이스 목록
curl -H "Authorization: Bearer <토큰>" \\
  http://localhost:3000/api/spaces

# 전문 검색
curl -H "Authorization: Bearer <토큰>" \\
  "http://localhost:3000/api/search?q=배포"

# 페이지 목록 / 마크다운 원문 읽기
curl -H "Authorization: Bearer <토큰>" \\
  http://localhost:3000/api/spaces/eng/pages
curl -H "Authorization: Bearer <토큰>" \\
  http://localhost:3000/api/spaces/eng/pages/배포-가이드

# 새 페이지 생성 (editor 권한)
curl -X POST -H "Authorization: Bearer <토큰>" \\
  -H "Content-Type: application/json" \\
  -d '{"title":"릴리스 노트","content":"# 릴리스 노트\\n\\n..."}' \\
  http://localhost:3000/api/spaces/eng/pages

# 페이지 수정 (editor 권한, 새 리비전 생성)
curl -X PUT -H "Authorization: Bearer <토큰>" \\
  -H "Content-Type: application/json" \\
  -d '{"title":"배포 가이드","content":"# 배포 가이드\\n\\n수정됨"}' \\
  http://localhost:3000/api/spaces/eng/pages/배포-가이드`}</pre>
      </section>
    </main>
  );
}
