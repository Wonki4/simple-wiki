import { describe, expect, it } from "vitest";
import {
  formatKstDay, isTimelineDay, kstDayEnd, kstDayStart, resolveTimelineRange, timelineMonthBounds,
} from "@/lib/timeline-period";

describe("calendar ranges for a space timeline", () => {
  it("anchors the default to the current day in Korea", () => {
    expect(resolveTimelineRange({}, new Date("2026-05-31T14:59:59.999Z")))
      .toEqual({ period: "1m", from: "2026-05-01", to: "2026-05-31" });
    expect(resolveTimelineRange({}, new Date("2026-05-31T15:00:00Z")))
      .toEqual({ period: "1m", from: "2026-05-02", to: "2026-06-01" });
  });

  it.each([
    ["1m", "2026-03-31", "2026-03-01"],
    ["1m", "2024-03-29", "2024-02-29"],
    ["3m", "2026-11-25", "2026-08-26"],
    ["6m", "2026-11-25", "2026-05-26"],
    ["1y", "2024-02-29", "2023-03-01"],
    ["3y", "2026-02-28", "2023-03-01"],
  ])("handles the shared %s ending on %s", (period, to, from) => {
    expect(resolveTimelineRange({ period, to })).toEqual({ period, from, to });
  });

  it("accepts a one-day range and clips partial months for detail queries", () => {
    const range = resolveTimelineRange({ period: "custom", from: "2024-02-28", to: "2024-03-01" })!;
    expect(timelineMonthBounds(range, "2024-02")).toEqual({ from: "2024-02-28", to: "2024-02-29" });
    expect(timelineMonthBounds(range, "2024-03")).toEqual({ from: "2024-03-01", to: "2024-03-01" });
    expect(timelineMonthBounds(range, "2024-01")).toBeNull();
    expect(timelineMonthBounds(range, "2024-2")).toBeNull();
    expect(resolveTimelineRange({ period: "custom", from: "2024-02-29", to: "2024-02-29" })).not.toBeNull();
  });

  it("rejects invalid or normalized date inputs", () => {
    for (const day of ["2026-02-29", "2026-04-31", "2026-4-03", "0000-01-01", "2026-13-01", "", "2026-01-01T12:00Z"]) {
      expect(isTimelineDay(day)).toBe(false);
    }
    expect(resolveTimelineRange({ period: "custom", from: "2026-01-01" })).toBeNull();
    expect(resolveTimelineRange({ period: "custom", from: "2026-01-02", to: "2026-01-01" })).toBeNull();
    expect(resolveTimelineRange({ period: "all" })).toBeNull();
    expect(resolveTimelineRange({ period: "3y", to: "0001-01-01" })?.from).toBe("0001-01-01");
  });

  it("maps inclusive calendar dates to adjacent UTC instants", () => {
    expect(kstDayStart("2026-05-01").toISOString()).toBe("2026-04-30T15:00:00.000Z");
    expect(kstDayEnd("2026-05-31").toISOString()).toBe("2026-05-31T15:00:00.000Z");
    expect(formatKstDay(new Date("2026-05-31T15:00:00.000Z"))).toBe("2026-06-01");
  });
});
