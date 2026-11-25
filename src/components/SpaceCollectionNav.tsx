import { NavigationLink as Link } from "./NavigationLink";

export function SpaceCollectionNav({ spaceKey, active }: { spaceKey: string; active: "documents" | "timeline" }) {
  const home = `/s/${encodeURIComponent(spaceKey)}`;
  return (
    <nav className="tabs mb-6" aria-label="스페이스 보기">
      <Link href={home} className={active === "documents" ? "tab tab--active" : "tab"}
        aria-current={active === "documents" ? "page" : undefined}>문서</Link>
      <Link href={`${home}/-/timeline`} className={active === "timeline" ? "tab tab--active" : "tab"}
        aria-current={active === "timeline" ? "page" : undefined} prefetch={false}>타임라인</Link>
    </nav>
  );
}
