import Link from "next/link";
import { requireSpaceRole } from "@/lib/access";
import { listPageTrash } from "@/lib/page-trash";
import { restoreFromTrash } from "@/actions/pages";

export default async function TrashPage({ params, searchParams }: {
  params: Promise<{ spaceKey: string }>;
  searchParams: Promise<{ item?: string; error?: string }>;
}) {
  const { spaceKey } = await params;
  const { item, error } = await searchParams;
  const { space } = await requireSpaceRole(spaceKey, "editor");
  const pages = await listPageTrash(space.id);
  return (
    <main className="collection">
      <Link href={`/s/${spaceKey}`} className="crumb">← {space.name}</Link>
      <header className="collection-heading"><h1 className="document-title">문서 휴지통</h1></header>
      {error === "missing" && <p className="notice notice-warn" role="alert">이미 복원했거나 휴지통에 없는 문서입니다.</p>}
      {pages.length === 0 && <p className="muted">휴지통이 비어 있습니다.</p>}
      <ul className="trash-list">
        {pages.map(p => {
          const changeAddress = item === p.id && (error === "taken" || error === "invalid");
          return <li key={p.id}>
            <div><strong>{p.title}</strong> <span className="meta">/{p.slug}</span></div>
            <p className="meta">{p.parentTitle ?? "최상위"} · {p.deletedBy} 삭제 · <time dateTime={p.deletedAt.toISOString()}>{p.deletedAt.toISOString().slice(0, 16).replace("T", " ")} UTC</time></p>
            <form action={restoreFromTrash.bind(null, spaceKey, p.id)}>
              {changeAddress && <>
                <p className="notice notice-warn" role="alert">{error === "taken" ? "기존 주소를 다른 문서가 사용 중입니다." : "다른 문서 주소를 입력하세요. new와 settings는 스페이스 화면에서 사용합니다."}</p>
                <label>복원할 주소 <input name="slug" className="input" required defaultValue={p.slug} /></label>
              </>}
              <button className="btn btn-ghost btn-sm">복원</button>
            </form>
          </li>;
        })}
      </ul>
    </main>
  );
}
