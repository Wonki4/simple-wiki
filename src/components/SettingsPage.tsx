import Link from "next/link";
import type { ReactNode } from "react";

type SettingsSection = "space" | "groups" | "tokens" | "new-space";

export function SettingsPage({ title, description, section, isWikiAdmin, space, children }: {
  title: string;
  description?: string;
  section: SettingsSection;
  isWikiAdmin: boolean;
  space?: { key: string; name: string };
  children: ReactNode;
}) {
  const showAdminNavigation = isWikiAdmin && (section === "groups" || section === "new-space");
  const links: { section: SettingsSection; href: string; label: string }[] = [
    { section: "groups", href: "/groups", label: "그룹 관리" },
    { section: "new-space", href: "/spaces/new", label: "새 스페이스" },
  ];

  return (
    <main className="settings-page">
      <Link className="crumb" href={space ? `/s/${space.key}` : "/"}>← {space?.name ?? "위키 홈"}</Link>
      {showAdminNavigation && (
        <nav className="settings-nav" aria-label="위키 관리">
          {links.map(link => (
            <Link key={link.section} href={link.href} aria-current={section === link.section ? "page" : undefined}>
              {link.label}
            </Link>
          ))}
        </nav>
      )}
      <header className="settings-heading">
        <h1 className="document-title">{title}</h1>
        {description && <p>{description}</p>}
      </header>
      {children}
    </main>
  );
}
