export const TIMELINE_PERIODS = ["1m", "3m", "6m", "1y", "3y", "custom"] as const;
export type TimelinePeriod = typeof TIMELINE_PERIODS[number];
export type TimelineRange = { period: TimelinePeriod; from: string; to: string };

const monthsPerPeriod = { "1m": 1, "3m": 3, "6m": 6, "1y": 12, "3y": 36 };
const DAY = 24 * 60 * 60 * 1000;
const KST = 9 * 60 * 60 * 1000;

export function isTimelineDay(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith("0000-")) return false;
  const date = new Date(value + "T00:00:00Z");
  return Number.isFinite(date.getTime()) && date.toISOString().startsWith(value + "T");
}

export function formatKstDay(date: Date): string {
  return new Date(date.getTime() + KST).toISOString().slice(0, 10);
}

export function kstDayStart(day: string): Date {
  return new Date(day + "T00:00:00+09:00");
}

/** Exclusive upper bound of an inclusive KST calendar day. */
export function kstDayEnd(day: string): Date {
  return new Date(kstDayStart(day).getTime() + DAY);
}

// Work with midnight UTC as a calendar representation only. Subtract from the
// day *after* the inclusive end, clamping to the last day of a shorter month.
function periodStart(to: string, months: number): string {
  const start = new Date(Date.parse(to + "T00:00:00Z") + DAY);
  const day = start.getUTCDate();
  start.setUTCMonth(start.getUTCMonth() - months + 1, 0);
  start.setUTCDate(Math.min(day, start.getUTCDate()));
  return start.getUTCFullYear() < 1 ? "0001-01-01" : start.toISOString().slice(0, 10);
}

export function resolveTimelineRange(
  query: { period?: string; from?: string; to?: string },
  now = new Date(),
): TimelineRange | null {
  const period = TIMELINE_PERIODS.find(p => p === (query.period ?? "1m"));
  if (!period) return null;
  if (period === "custom") {
    const { from, to } = query;
    if (!from || !to || !isTimelineDay(from) || !isTimelineDay(to) || from > to) return null;
    return { period, from, to };
  }
  const to = query.to ?? formatKstDay(now);
  if (!isTimelineDay(to)) return null;
  return { period, from: periodStart(to, monthsPerPeriod[period]), to };
}

export function safeTimelineMonth(range: TimelineRange, month: string): boolean {
  return isTimelineDay(month + "-01") && month >= range.from.slice(0, 7) && month <= range.to.slice(0, 7);
}

/** Clip a detail query to its month and to the original user selection. */
export function timelineMonthBounds(range: TimelineRange, month: string) {
  if (!safeTimelineMonth(range, month)) return null;
  const firstDay = month + "-01";
  const last = new Date(firstDay + "T00:00:00Z");
  last.setUTCMonth(last.getUTCMonth() + 1, 0);
  const lastDay = last.toISOString().slice(0, 10);
  return { from: firstDay > range.from ? firstDay : range.from, to: lastDay < range.to ? lastDay : range.to };
}
