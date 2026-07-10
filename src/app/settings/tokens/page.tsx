import { requireSession } from "@/lib/access";
import { prisma } from "@/lib/db";
import { revokeApiToken } from "@/actions/tokens";
import { CreateTokenForm } from "@/components/CreateTokenForm";
import { ConfirmSubmitButton } from "@/components/ConfirmSubmitButton";

export default async function TokensPage() {
  const session = await requireSession();
  const tokens = await prisma.apiToken.findMany({
    where: { userId: session.userId },
    orderBy: { createdAt: "desc" },
  });

  return (
    <main className="py-10">
      <p className="eyebrow">settings · api</p>
      <h1 className="page-title mt-1">개인 액세스 토큰</h1>
      <p className="muted mt-2 max-w-2xl text-sm">
        MCP 서버 등 프로그램에서 API를 호출할 때 쓰는 토큰입니다. 토큰은 발급한 사용자의
        스페이스 권한을 그대로 상속하며, 읽기 API 호출 시{" "}
        <code style={{ fontFamily: "var(--font-mono)" }}>Authorization: Bearer &lt;토큰&gt;</code>{" "}
        헤더로 전달합니다.
      </p>

      <section className="mt-8">
        <h2 className="section-title">새 토큰 발급</h2>
        <div className="mt-3">
          <CreateTokenForm />
        </div>
      </section>

      <section className="mt-10">
        <h2 className="section-title">발급된 토큰</h2>
        <div className="mt-3 overflow-x-auto">
          <table className="dtable">
            <thead>
              <tr>
                <th>이름</th>
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
                  <td colSpan={5} className="muted">발급된 토큰이 없습니다.</td>
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

# 스페이스의 페이지 목록
curl -H "Authorization: Bearer <토큰>" \\
  http://localhost:3000/api/spaces/eng/pages

# 페이지 마크다운 원문
curl -H "Authorization: Bearer <토큰>" \\
  http://localhost:3000/api/spaces/eng/pages/배포-가이드`}</pre>
      </section>
    </main>
  );
}
