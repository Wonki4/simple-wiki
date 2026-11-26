import { redirect } from "next/navigation";
import { NavigationLink as Link } from "@/components/NavigationLink";
import { SpaceCollectionNav } from "@/components/SpaceCollectionNav";
import { WikiIcon } from "@/components/WikiIcon";
import { requireSpaceRole } from "@/lib/access";
import { hasRole } from "@/lib/permissions";
import { getTimelineMonth, getTimelineOverview, type TimelineEvent } from "@/lib/space-timeline";
import { resolveTimelineRange, TIMELINE_PERIODS, type TimelinePeriod, type TimelineRange } from "@/lib/timeline-period";
import { TimelineCopyRequest } from "./TimelineCopyRequest";
import styles from "./timeline.module.css";

const periodLabels: Record<TimelinePeriod, string> = {
  "1m": "1개월", "3m": "3개월", "6m": "6개월", "1y": "1년", "3y": "3년", custom: "사용자 지정",
};
const eventLabels = { decision: "결정", discussion: "회의·논의", document: "문서 수정", comment: "댓글" };

function timelineUrl(path: string, range: TimelineRange, month?: string, cursor?: string) {
  const params = new URLSearchParams({ period: range.period, to: range.to });
  if (range.period === "custom") params.set("from", range.from);
  if (month) params.set("month", month);
  if (month && cursor) params.set("cursor", cursor);
  return `${path}?${params}`;
}

function EventRow({ event, home }: { event: TimelineEvent; home: string }) {
  const pageUrl = `${home}/${encodeURIComponent(event.slug)}`;
  const [, month, day] = event.day.split("-");
  const typeLabel = event.kind === "document" && event.created ? "새 문서" : eventLabels[event.kind];
  let content;
  if (event.kind === "document") {
    const href = event.fromVersion === event.toVersion ? `${pageUrl}/history/${event.toVersion}`
      : `${pageUrl}/history?from=${event.fromVersion}&to=${event.toVersion}`;
    content = <Link className={styles.documentLink} href={href}>
      {event.title} <span>{event.fromVersion === event.toVersion ? `v${event.toVersion}` : `v${event.fromVersion} → v${event.toVersion}`}</span>
    </Link>;
  } else if (event.kind === "comment") {
    // A document navigation lets the browser scroll to and highlight the actual comment.
    content = <a className={styles.documentLink} href={`${pageUrl}#comment-${encodeURIComponent(event.commentId)}`}>
      {event.title} <span>댓글 {event.count}개</span>
    </a>;
  } else {
    content = <details className={styles.fact}>
      <summary>{event.summary}</summary>
      <blockquote>{event.evidence}</blockquote>
      <Link className={styles.source} href={`${pageUrl}/history/${event.version}`}>{event.title} v{event.version}</Link>
    </details>;
  }
  return (
    <li className={styles.event}>
      <time dateTime={event.day}>{Number(month)}월 {Number(day)}일</time>
      <div className={styles.entry}>
        <div className={styles.eventKind} data-kind={event.kind}>{typeLabel}
          {(event.kind === "decision" || event.kind === "discussion") && !event.explicitDate && <span>기록일 기준</span>}
        </div>
        {content}
      </div>
    </li>
  );
}

type Query = Partial<Record<"period" | "from" | "to" | "month" | "cursor", string | string[]>>;

export default async function SpaceTimeline({ params, searchParams }: {
  params: Promise<{ spaceKey: string }>; searchParams: Promise<Query>;
}) {
  const { spaceKey } = await params;
  const { space, role } = await requireSpaceRole(spaceKey, "viewer");
  const canEdit = hasRole(role, "editor");
  const query: Record<string, string | undefined> = Object.fromEntries(
    Object.entries(await searchParams).map(([key, value]) => [key, Array.isArray(value) ? value[0] : value]),
  );
  const home = `/s/${encodeURIComponent(space.key)}`;
  const path = `${home}/-/timeline`;
  const defaultRange = resolveTimelineRange({})!;
  const selected = resolveTimelineRange(query);
  if (selected && !query.to && selected.period !== "custom") {
    redirect(timelineUrl(path, selected, query.month, query.cursor));
  }
  const range = selected ?? defaultRange;
  const months = selected ? await getTimelineOverview(space.id, range) : [];
  const openMonth = months.find(item => item.month === query.month);
  const detail = openMonth ? await getTimelineMonth(space.id, range, openMonth.month, query.cursor) : null;

  return (
    <main className={`collection ${styles.timeline}`}>
      <Link className="document-path" href={home}><WikiIcon name="book" /><span>{space.name}</span></Link>
      <header className="collection-heading"><h1 className="document-title">스페이스 타임라인</h1></header>
      <SpaceCollectionNav spaceKey={space.key} active="timeline" canEdit={canEdit} />
      <nav aria-label="조회 기간" className={styles.periods}>
        {TIMELINE_PERIODS.map(period => <Link key={period} prefetch={false}
          aria-current={(selected?.period ?? query.period) === period ? "page" : undefined}
          href={timelineUrl(path, { ...range, period })}>
          {periodLabels[period]}
        </Link>)}
      </nav>
      {(range.period === "custom" || query.period === "custom") && <form action={path} method="get" className={styles.dates}>
        <input type="hidden" name="period" value="custom" />
        <label>시작일<input type="date" name="from" defaultValue={query.from ?? range.from} required /></label>
        <label>종료일<input type="date" name="to" defaultValue={query.to ?? range.to} required /></label>
        <button type="submit" className="btn btn-ghost btn-sm">기간 적용</button>
      </form>}
      {!selected && <p className="notice notice-warn mt-4" role="alert">유효한 기간을 선택하세요. 시작일은 종료일과 같거나 앞서야 합니다.</p>}
      {selected && <>
        <div className={styles.rangeBar}>
          <p className={styles.range}><time dateTime={range.from}>{range.from}</time><span> – </span><time dateTime={range.to}>{range.to}</time></p>
          <TimelineCopyRequest key={`${range.from}/${range.to}`} from={range.from} to={range.to}
            spaceKey={space.key} canEdit={canEdit} />
        </div>
        {months.length === 0 && <p className="empty-collection">이 기간에 표시할 기록이 없습니다.</p>}
        {months.map(group => {
          const [year, month] = group.month.split("-");
          const title = `${year}년 ${Number(month)}월`;
          const expanded = group.month === openMonth?.month && detail !== null;
          const items = expanded ? detail.items : group.highlights;
          const anchor = `#month-${group.month}`;
          const countLabels = [
            ["결정", group.counts.decision], ["회의·논의", group.counts.discussion],
            ["문서 변화", group.counts.document], ["댓글 묶음", group.counts.comment],
          ].filter(([, count]) => count).map(([label, count]) => `${label} ${count}건`);
          return <section key={group.month} id={anchor.slice(1)} className={styles.month} aria-label={title}>
            <header className={styles.monthHeader}>
              <div><h2>{title}</h2><p>{countLabels.join(" · ")}</p></div>
              <Link href={timelineUrl(path, range, expanded ? undefined : group.month) + anchor} prefetch={false}
                aria-controls={`events-${group.month}`} aria-expanded={expanded}
                aria-label={expanded ? `${title} 전체 기록 접기` : `${title} 전체 기록 보기`} className={styles.expand}>
                {expanded ? "접기" : `전체 ${group.total}건 보기`}
              </Link>
            </header>
            <ul className={styles.events} id={`events-${group.month}`}>
              {items.map(event => <EventRow key={event.id} event={event} home={home} />)}
            </ul>
            {expanded && (query.cursor || detail.nextCursor) && <nav className="search-pagination" aria-label={`${title} 기록 탐색`}>
              {query.cursor && <Link prefetch={false} href={timelineUrl(path, range, group.month) + anchor}>월의 첫 기록</Link>}
              {detail.nextCursor && <Link prefetch={false} href={timelineUrl(path, range, group.month, detail.nextCursor) + anchor}>다음 기록</Link>}
            </nav>}
          </section>;
        })}
      </>}
    </main>
  );
}
