import { NavigationLink as Link } from "./NavigationLink";
import { Disclosure } from "./Disclosure";

const views = [
  ["documents", "문서"],
  ["timeline", "타임라인"],
  ["attachments", "첨부파일"],
] as const;
const tools = [
  ["broken-links", "깨진 위키링크"],
  ["orphan-pages", "고아 문서"],
  ["trash", "휴지통"],
] as const;
type SpaceView = (typeof views | typeof tools)[number][0];

export function SpaceCollectionNav({ spaceKey, active, canEdit }: { spaceKey: string; active: SpaceView; canEdit: boolean }) {
  const home = `/s/${encodeURIComponent(spaceKey)}`;
  return (
    <nav className="tabs space-nav mb-6" aria-label="스페이스 보기">
      {views.map(([id, label]) => (
        <Link key={id} href={id === "documents" ? home : `${home}/-/${id}`}
          className={active === id ? "tab tab--active" : "tab"} aria-current={active === id ? "page" : undefined}
          prefetch={id === "documents" ? undefined : false}>{label}</Link>
      ))}
      <Disclosure className="space-nav__tools" label="문서 정리" trigger="문서 정리">
        {tools.filter(([id]) => id !== "trash" || canEdit).map(([id, label]) => (
          <Link key={id} href={`${home}/-/${id}`} prefetch={false}
            aria-current={active === id ? "page" : undefined}>{label}</Link>
        ))}
      </Disclosure>
    </nav>
  );
}
