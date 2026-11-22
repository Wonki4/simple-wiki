import type { ReactNode } from "react";
import type { Section } from "@/lib/reading-markup";
import { ArticleToc } from "@/components/ArticleToc";

export function DocumentLayout({ sections, children }: { sections: Section[]; children: ReactNode }) {
  const hasToc = sections.length > 1;
  return (
    <main className={`document${hasToc ? " document--with-toc" : ""}`}>
      <div className="document-body">{children}</div>
      {hasToc && <aside className="document-toc"><ArticleToc sections={sections} /></aside>}
    </main>
  );
}
