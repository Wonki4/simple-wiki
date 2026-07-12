import Link from "next/link";
import { requireSession, listReadableSpaces } from "@/lib/access";
import { listLikedPages } from "@/lib/likes";

export default async function MyPage() {
  const session = await requireSession();
  const spaces = await listReadableSpaces(session);
  const liked = await listLikedPages(
    session.userId,
    spaces.map((s) => s.id),
  );

  return (
    <main className="wrap py-10">
      <p className="eyebrow">my page</p>
      <h1 className="page-title mt-1">마이페이지</h1>

      <h2 className="section-title mt-8">좋아요한 글</h2>
      <ul className="mt-4 grid gap-5">
        {liked.map((p) => (
          <li key={`${p.spaceKey}/${p.slug}`}>
            <span className="meta">{p.spaceName}</span>
            <div className="mt-0.5">
              <Link
                href={`/s/${p.spaceKey}/${encodeURIComponent(p.slug)}`}
                className="title-link text-[1.05rem]"
              >
                {p.title}
              </Link>
            </div>
          </li>
        ))}
        {liked.length === 0 && <li className="muted">아직 좋아요한 글이 없습니다.</li>}
      </ul>
    </main>
  );
}
