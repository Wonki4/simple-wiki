import { Disclosure } from "@/components/Disclosure";
import { WikiIcon } from "@/components/WikiIcon";
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
  const currentParent = allPages.find((p) => p.id === page.parentId);
  const currentParentSlug = currentParent?.slug ?? "";
  const documentUrl = `/s/${spaceKey}/${encodeURIComponent(slug)}`;

  return (
    <main className="document">
      {error && <div className="notice notice-warn" role="alert">{error}</div>}
      <div className="document-toolbar">
        <Link href={`/s/${spaceKey}`} className="document-path">
          <WikiIcon name="book" /><span>{space.name}</span>
        </Link>
        {canEdit && (
          <div className="document-actions">
            <Link href={`${documentUrl}/edit`} className="btn btn-ghost"><WikiIcon name="edit" />편집</Link>
            <Disclosure label="문서 더보기" trigger={<WikiIcon name="more" />}>
              <Link href={`${documentUrl}/history`}>이력</Link>
              <Link href={`/s/${spaceKey}/new?parent=${encodeURIComponent(slug)}`}>하위 문서</Link>
              <details className="move" data-parent={currentParentSlug}>
                <summary className="menu-item" aria-label="이동할 위치">
                  문서 이동 ▾
                </summary>
                <form action={movePage.bind(null, spaceKey, slug)} className="move__panel">
                  <button name="parent" value="" className="move__item" disabled={!currentParent}>
                    (최상위)
                  </button>
                  {moveTargets.map((t) => (
                    <button
                      key={t.id}
                      name="parent"
                      value={t.slug}
                      className="move__item"
                      style={{ paddingLeft: `${0.6 + t.depth * 0.9}rem` }}
                      disabled={t.slug === currentParentSlug}
                    >
                      {t.title}
                    </button>
                  ))}
                </form>
              </details>
              <form action={deletePage.bind(null, spaceKey, slug)}>
                <ConfirmSubmitButton message="이 페이지를 삭제할까요?" className="menu-item danger-text">삭제</ConfirmSubmitButton>
              </form>
            </Disclosure>
          </div>
        )}
      </div>

      <header className="document-heading">
        <h1 className="document-title">{page.title}</h1>
        <p className="document-meta">
          마지막 수정 <time dateTime={page.updatedAt.toISOString()}>{page.updatedAt.toISOString().slice(0, 16).replace("T", " ")}</time>
          <EditSourceBadge source={page.updatedSource} label={page.updatedViaLabel} />
        </p>
      </header>
      <article className="prose-wiki" dangerouslySetInnerHTML={{ __html: html }} />
      <div className="document-reactions">
        <LikeButton spaceKey={spaceKey} slug={slug} count={likeState.count} liked={likeState.liked} />
      </div>

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

      <section className="mt-6 border-t pt-6">
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
