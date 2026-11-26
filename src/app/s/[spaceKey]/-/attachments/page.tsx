import Link from "next/link";
import { SpaceCollectionNav } from "@/components/SpaceCollectionNav";
import { WikiIcon } from "@/components/WikiIcon";
import { AttachmentThumbnail } from "@/components/AttachmentThumbnail";
import { requireSpaceRole } from "@/lib/access";
import { isPreviewableImage } from "@/lib/attachment-image";
import { listAttachmentUsage } from "@/lib/attachment-usage";
import { hasRole } from "@/lib/permissions";

export default async function AttachmentsPage({ params, searchParams }: {
  params: Promise<{ spaceKey: string }>;
  searchParams: Promise<{ q?: string }>;
}) {
  const { spaceKey } = await params;
  const { space, role } = await requireSpaceRole(spaceKey, "viewer");
  const { q } = await searchParams;
  const filename = typeof q === "string" ? q.trim() : "";
  const files = await listAttachmentUsage(space, filename);
  const home = `/s/${encodeURIComponent(spaceKey)}`;
  return (
    <main className="collection">
      <Link href={home} className="crumb">← {space.name}</Link>
      <header className="collection-heading">
        <h1 className="document-title">첨부파일</h1>
        <p>이 스페이스에 올린 파일과 현재 본문에서 파일을 사용하는 문서입니다.</p>
      </header>
      <SpaceCollectionNav spaceKey={space.key} active="attachments" canEdit={hasRole(role, "editor")} />
      <form action={`${home}/-/attachments`} className="attachment-search" role="search" aria-label="첨부파일 검색">
        <input name="q" type="search" className="input" aria-label="파일 이름" placeholder="파일 이름 검색" defaultValue={filename} />
        <button className="btn btn-ghost btn-sm">검색</button>
        {filename && <Link href={`${home}/-/attachments`} className="linklike">전체 보기</Link>}
      </form>
      <h2 className="collection-label">{filename ? "검색 결과" : "전체 파일"} · {files.length.toLocaleString("ko-KR")}개</h2>
      {files.length === 0 ? (
        <p className="empty-collection">{filename ? "일치하는 파일이 없습니다." : "아직 업로드한 첨부파일이 없습니다."}</p>
      ) : (
        <ul className="attachment-list">
          {files.map(file => (
            <li key={file.id}>
              {isPreviewableImage(file.mime) ? (
                <AttachmentThumbnail id={file.id} filename={file.filename} />
              ) : (
                <span className="attachment-visual" aria-hidden="true"><WikiIcon name="file" /></span>
              )}
              <div>
                <h3>{file.filename}</h3>
                <p className="meta"><time dateTime={file.createdAt.toISOString()}>{file.createdAt.toISOString().slice(0, 10)}</time> · {file.size.toLocaleString("ko-KR")} 바이트</p>
              </div>
              <div>
                <p className="meta">{file.pages.length ? `사용 문서 ${file.pages.length}개` : "사용 중인 문서 없음"}</p>
                {file.pages.length > 0 && <ul>
                  {file.pages.map(page => <li key={page.slug}><Link className="linklike" href={`${home}/${encodeURIComponent(page.slug)}`}>{page.title}</Link></li>)}
                </ul>}
              </div>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
