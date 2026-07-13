import { requireSession, listReadableSpaces } from "@/lib/access";
import { listLikedPages } from "@/lib/likes";
import { listCommentedPages } from "@/lib/comments";
import { ActivityTabs } from "@/components/ActivityTabs";

export default async function MyPage() {
  const session = await requireSession();
  const spaces = await listReadableSpaces(session);
  const spaceIds = spaces.map((s) => s.id);
  const [liked, commented] = await Promise.all([
    listLikedPages(session.userId, spaceIds),
    listCommentedPages(session.userId, spaceIds),
  ]);

  return (
    <main className="wrap py-10">
      <p className="eyebrow">my page</p>
      <h1 className="page-title mt-1">마이페이지</h1>

      <h2 className="section-title mt-8">활동</h2>
      <ActivityTabs liked={liked} commented={commented} />
    </main>
  );
}
