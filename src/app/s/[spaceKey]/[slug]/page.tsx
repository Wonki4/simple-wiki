import Link from "next/link";
import { requireSpaceRole } from "@/lib/access";
import { prisma } from "@/lib/db";
import { hasRole } from "@/lib/permissions";
import { getRenderedPageHtml } from "@/lib/page-render-cache";
import { deletePage, movePage } from "@/actions/pages";
import { ConfirmSubmitButton } from "@/components/ConfirmSubmitButton";
import { EditSourceBadge } from "@/components/EditSourceBadge";
import { LikeButton } from "@/components/LikeButton";
import { getLikeState } from "@/lib/likes";
import { listComments } from "@/lib/comments";
import { deleteComment } from "@/actions/comments";
import { CommentForm } from "@/components/CommentForm";
import { buildTree, flattenTree, selfAndDescendantIds } from "@/lib/page-tree";

export default async function PageView({
  params,
  searchParams,
}: {
  params: Promise<{ spaceKey: string; slug: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { spaceKey, slug: rawSlug } = await params;
  const { error } = await searchParams;
  const slug = decodeURIComponent(rawSlug);
  const { session, space, role } = await requireSpaceRole(spaceKey, "viewer");
  const canEdit = hasRole(role, "editor");

  const page = await prisma.page.findUnique({
    where: { spaceId_slug: { spaceId: space.id, slug } },
  });

  if (!page) {
    return (
      <main className="py-20 text-center">
        <p className="eyebrow">404</p>
        <h1 className="page-title mt-3">아직 없는 페이지입니다</h1>
        {canEdit ? (
          <Link
            href={`/s/${spaceKey}/new?title=${encodeURIComponent(slug)}`}
            className="btn btn-primary mt-5 inline-flex"
          >
            이 제목으로 페이지 만들기
          </Link>
        ) : (
          <p className="muted mt-3">편집 권한이 있는 사용자가 만들 수 있습니다.</p>
        )}
      </main>
    );
  }

  const likeState = await getLikeState(page.id, session.userId);
  const comments = await listComments(page.id);
  const canModerate = hasRole(role, "admin");
  const html = await getRenderedPageHtml({
    pageId: page.id,
    version: page.version,
    content: page.content,
    spaceId: space.id,
    spaceKey,
  });

  const backlinks = await prisma.pageLink.findMany({
    where: { toSpaceId: space.id, toSlug: slug },
    include: { fromPage: { select: { title: true, slug: true } } },
  });

  // 이동 드롭다운: 자기 자신·자손 제외한 전체 문서(트리 순서·들여쓰기)
  const allPages = canEdit
    ? await prisma.page.findMany({
        where: { spaceId: space.id },
        select: { id: true, slug: true, title: true, parentId: true },
      })
    : [];
  const blocked = canEdit ? selfAndDescendantIds(allPages, page.id) : new Set<string>();
  const moveTargets = canEdit
    ? flattenTree(buildTree(allPages)).filter((t) => !blocked.has(t.id))
    : [];
  const currentParentSlug = allPages.find((p) => p.id === page.parentId)?.slug ?? "";

  return (
    <main className="py-10">
      {error && (
        <div className="notice notice-warn mb-4" role="alert">
          {error}
        </div>
      )}
      {/* 상단 줄: breadcrumb + 문서 액션 버튼. 제목 줄에서 분리해 제목이 눌리지 않게 한다. */}
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <Link href={`/s/${spaceKey}`} className="crumb">
          {space.key} / {space.name}
        </Link>
        {canEdit && (
          <div className="flex items-center gap-2">
            <Link
              href={`/s/${spaceKey}/new?parent=${encodeURIComponent(slug)}`}
              className="btn btn-ghost btn-sm"
            >
              하위 문서
            </Link>
            <Link href={`/s/${spaceKey}/${encodeURIComponent(slug)}/edit`} className="btn btn-ghost btn-sm">편집</Link>
            <Link href={`/s/${spaceKey}/${encodeURIComponent(slug)}/history`} className="btn btn-ghost btn-sm">이력</Link>
            <form action={deletePage.bind(null, spaceKey, slug)}>
              <ConfirmSubmitButton message="이 페이지를 삭제할까요?" className="btn btn-danger btn-sm">
                삭제
              </ConfirmSubmitButton>
            </form>
          </div>
        )}
      </div>

      {/* 제목 줄: 제목 + 위치(이동) 컨트롤만. select와 버튼 높이를 맞춰 정렬한다. */}
      <div className="mt-2 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <h1 className="page-title min-w-0">{page.title}</h1>
        {canEdit && (
          <form action={movePage.bind(null, spaceKey, slug)} className="flex shrink-0 items-stretch gap-1">
            <select
              name="parent"
              defaultValue={currentParentSlug}
              className="select btn-sm w-auto max-w-[11rem]"
              aria-label="이동할 위치"
            >
              <option value="">(최상위)</option>
              {moveTargets.map((t) => (
                <option key={t.id} value={t.slug}>
                  {"  ".repeat(t.depth) + t.title}
                </option>
              ))}
            </select>
            <button className="btn btn-ghost btn-sm">이동</button>
          </form>
        )}
      </div>

      <p className="meta mt-2">
        마지막 수정 {page.updatedAt.toISOString().slice(0, 16).replace("T", " ")}
        <EditSourceBadge source={page.updatedSource} label={page.updatedViaLabel} />
      </p>
      <div className="mt-3">
        <LikeButton spaceKey={spaceKey} slug={slug} count={likeState.count} liked={likeState.liked} />
      </div>

      <article className="prose-wiki mt-7" dangerouslySetInnerHTML={{ __html: html }} />

      {backlinks.length > 0 && (
        <aside className="mt-12 border-t pt-5">
          <h2 className="eyebrow">이 페이지를 링크한 문서</h2>
          <ul className="mt-3 grid gap-1.5 text-sm">
            {backlinks.map((b) => (
              <li key={b.id}>
                <Link href={`/s/${spaceKey}/${encodeURIComponent(b.fromPage.slug)}`} className="title-link">
                  {b.fromPage.title}
                </Link>
              </li>
            ))}
          </ul>
        </aside>
      )}

      <section className="mt-12 border-t pt-6">
        <h2 className="section-title">
          댓글{comments.length > 0 && <span className="faint"> {comments.length}</span>}
        </h2>
        <ul className="comment-list mt-4">
          {comments.map((c) => (
            <li key={c.id} className="comment">
              <div className="comment__head">
                <span className="comment__author">{c.authorName}</span>
                <span className="comment__time">
                  {c.createdAt.toISOString().slice(0, 16).replace("T", " ")}
                </span>
                {(c.authorId === session.userId || canModerate) && (
                  <form action={deleteComment.bind(null, spaceKey, slug, c.id)} className="comment__del">
                    <ConfirmSubmitButton message="이 댓글을 삭제할까요?" className="comment__del-btn">
                      삭제
                    </ConfirmSubmitButton>
                  </form>
                )}
              </div>
              <p className="comment__body">{c.body}</p>
            </li>
          ))}
          {comments.length === 0 && (
            <li className="muted text-sm">아직 댓글이 없습니다. 첫 댓글을 남겨보세요.</li>
          )}
        </ul>
        <div className="mt-6">
          <CommentForm spaceKey={spaceKey} slug={slug} />
        </div>
      </section>
    </main>
  );
}
