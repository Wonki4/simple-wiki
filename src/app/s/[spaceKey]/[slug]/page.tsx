import { Disclosure } from "@/components/Disclosure";
import { WikiIcon } from "@/components/WikiIcon";
import { NavigationLink as Link } from "@/components/NavigationLink";
import { listReadableSpaces, requireSpaceRole } from "@/lib/access";
import { prisma } from "@/lib/db";
import { hasRole } from "@/lib/permissions";
import { getSpaceTree } from "@/lib/space-tree";
import { getBacklinks } from "@/lib/wiki-link-destinations";
import { WikiArticle } from "@/components/WikiArticle";
import { ArticleToc } from "@/components/ArticleToc";
import { DocumentLayout } from "@/components/DocumentLayout";
import { DocumentSource } from "@/components/DocumentSource";
import { DocumentBacklinks } from "@/components/DocumentBacklinks";
import { getRenderedPage } from "@/lib/page-render-cache";
import { deletePage, movePage } from "@/actions/pages";
import { ConfirmSubmitButton } from "@/components/ConfirmSubmitButton";
import { EditSourceBadge } from "@/components/EditSourceBadge";
import { LikeButton } from "@/components/LikeButton";
import { getLikeState } from "@/lib/likes";
import { listComments } from "@/lib/comments";
import { deleteComment } from "@/actions/comments";
import { CommentForm } from "@/components/CommentForm";
import { UserAvatar } from "@/components/UserAvatar";
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
    where: { deletedAt: null, spaceId_slug: { spaceId: space.id, slug } },
    include: { htmlPreview: { select: { baseVersion: true } } },
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

  const [author, likeState, comments] = await Promise.all([
    prisma.user.findUnique({
      where: { id: page.createdById },
      select: { name: true, username: true, imageUrl: true },
    }),
    getLikeState(page.id, session.userId),
    listComments(page.id),
  ]);
  const authorName = author?.name.trim() || author?.username?.trim() || "알 수 없음";
  const canModerate = hasRole(role, "admin");
  const readable = await listReadableSpaces(session);
  const article = await getRenderedPage({
    pageId: page.id,
    version: page.version,
    content: page.content,
    spaceId: space.id,
    spaceKey, readable,
  });

  const backlinks = await getBacklinks(space, slug, readable);

  // 이동 드롭다운: 자기 자신·자손 제외한 전체 문서(트리 순서·들여쓰기)
  const allPages = canEdit ? await getSpaceTree(space.id) : [];
  const blocked = canEdit ? selfAndDescendantIds(allPages, page.id) : new Set<string>();
  const moveTargets = canEdit
    ? flattenTree(buildTree(allPages)).filter((t) => !blocked.has(t.id))
    : [];
  const visibleParentId = allPages.find(p => p.id === page.id)?.parentId;
  const currentParent = allPages.find(p => p.id === visibleParentId);
  const currentParentSlug = currentParent?.slug ?? "";
  const documentUrl = `/s/${spaceKey}/${encodeURIComponent(slug)}`;

  return (
    <DocumentLayout sections={article.sections}>
      {error && <div className="notice notice-warn" role="alert">{error}</div>}
      <div className="document-toolbar">
        <Link href={`/s/${spaceKey}`} className="document-path">
          <WikiIcon name="book" /><span>{space.name}</span>
        </Link>
        <div className="document-actions">
          {page.htmlPreview && <Link href={`${documentUrl}/html`} className="btn btn-ghost">HTML 미리보기</Link>}
          {canEdit
            ? <Link href={`${documentUrl}/edit`} className="btn btn-ghost"><WikiIcon name="edit" />편집</Link>
            : <Link href={`${documentUrl}/history`} className="btn btn-ghost">이력</Link>}
          <Disclosure label="문서 더보기" trigger={<WikiIcon name="more" />}>
            {canEdit && <Link href={`${documentUrl}/history`}>이력</Link>}
            <DocumentSource source={page.content} title={page.title} />
            {canEdit && <>
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
                <ConfirmSubmitButton message="이 문서를 휴지통으로 옮길까요? 휴지통에서 복원할 수 있습니다." className="menu-item danger-text">삭제</ConfirmSubmitButton>
              </form>
            </>}
          </Disclosure>
        </div>
      </div>

      <header className="document-heading">
        <h1 className="document-title">{page.title}</h1>
        <div className="document-meta-row">
          <div className="document-meta-stack">
            <p className="document-author">
              작성자
              <span className="document-author__identity">
                <UserAvatar name={authorName} imageUrl={author?.imageUrl} />
                <span>{authorName}</span>
              </span>
            </p>
            <p className="document-meta">
              마지막 수정 <time dateTime={page.updatedAt.toISOString()}>{page.updatedAt.toISOString().slice(0, 16).replace("T", " ")}</time>
              <EditSourceBadge source={page.updatedSource} label={page.updatedViaLabel} />
            </p>
          </div>
          <ArticleToc sections={article.sections} compact />
        </div>
      </header>
      <WikiArticle html={article.html} />
      <div className="document-reactions">
        <LikeButton spaceKey={spaceKey} slug={slug} count={likeState.count} liked={likeState.liked} />
      </div>

      <DocumentBacklinks backlinks={backlinks} spaceKey={spaceKey} />

      <section className="mt-6 border-t pt-6">
        <h2 className="section-title">
          댓글{comments.length > 0 && <span className="faint"> {comments.length}</span>}
        </h2>
        <ul className="comment-list mt-4">
          {comments.map((c) => (
            <li key={c.id} className="comment">
              <div className="comment__head">
                <span className="comment__author">
                  <UserAvatar name={c.authorName} imageUrl={c.authorImageUrl} />
                  <span>{c.authorName}</span>
                </span>
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
    </DocumentLayout>
  );
}
