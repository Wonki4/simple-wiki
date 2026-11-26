import { notFound } from "next/navigation";
import { NavigationLink as Link } from "@/components/NavigationLink";
import { SpaceCollectionNav } from "@/components/SpaceCollectionNav";
import { WikiIcon } from "@/components/WikiIcon";
import { requireSpaceRole } from "@/lib/access";
import { getWikiTopic } from "@/lib/llm-wiki";
import { hasRole } from "@/lib/permissions";
import styles from "../topics.module.css";

const sections = [
  ["current", "현재 기준"],
  ["example", "적용 사례"],
  ["discussion", "논의 중"],
] as const;

export default async function WikiTopicPage({ params }: { params: Promise<{ spaceKey: string; topicKey: string }> }) {
  const { spaceKey, topicKey } = await params;
  const { space, role } = await requireSpaceRole(spaceKey, "viewer");
  let key: string;
  try {
    key = decodeURIComponent(topicKey);
  } catch {
    notFound();
  }
  const topic = await getWikiTopic(space.id, key);
  if (!topic) notFound();
  const home = `/s/${encodeURIComponent(space.key)}`;

  return (
    <main className="collection">
      <Link className="document-path" href={`${home}/-/llm-wiki`}>
        <WikiIcon name="book" /><span>{space.name} · 주제 목록</span>
      </Link>
      <header className="collection-heading">
        <h1 className="document-title">{topic.title}</h1>
        <p className="document-meta"><time dateTime={topic.updatedAt}>{topic.updatedAt.slice(0, 10)}</time> 갱신</p>
      </header>
      <SpaceCollectionNav spaceKey={space.key} active="llm-wiki" canEdit={hasRole(role, "editor")} />
      {sections.map(([kind, label]) => {
        const items = topic.items.filter(item => item.kind === kind);
        if (!items.length) return null;
        return (
          <section className={styles.section} key={kind} aria-labelledby={`topic-${kind}`}>
            <h2 className="collection-label" id={`topic-${kind}`}>{label}</h2>
            <ul>
              {items.map(({ key, text, source }) => (
                <li className={styles.item} key={key}>
                  <p>{text}</p>
                  <div className={styles.citation}>
                    <details>
                      <summary>근거 문장</summary>
                      <blockquote>{source.evidence}</blockquote>
                    </details>
                    <Link className={styles.source} href={`${home}/${encodeURIComponent(source.slug)}/history/${source.version}?pageId=${encodeURIComponent(source.pageId)}`} prefetch={false}>
                      {source.title} v{source.version}
                    </Link>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </main>
  );
}
