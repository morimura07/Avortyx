/**
 * Hourly / daily bucket helpers used by the dashboard charts when they need
 * to re-aggregate from a *filtered* set of calls (e.g. destination scope).
 *
 * The shapes are intentionally compatible with TODAY_HOURLY / LAST_14_DAYS in
 * lib/mock/timeseries.ts, so the charts can switch between static seeded data
 * and freshly bucketed data without any other changes.
 */

import type { Call } from "@/lib/types";
import { getDemoTimezone, hourInTimeZone, startOfDayInTimeZone } from "@/lib/demo/tz";

const DAY_MS = 1000 * 60 * 60 * 24;
const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export interface HourBucket {
  hour: number;
  label: string;
  calls: number;
  conversions: number;
  revenue: number;
}

export interface DayBucket {
  offset: number;
  label: string;
  calls: number;
  conversions: number;
  revenue: number;
}

/** 24 buckets, one per hour of today in the user's selected demo
 *  timezone. Anchoring both the day-start and the per-call hour to the
 *  same timezone means bars appear at the same hours the user picked in
 *  the timezone dropdown — not at their PC's local hours. */
export function bucketHourly(calls: Call[]): HourBucket[] {
  const tz = getDemoTimezone();
  const start = startOfDayInTimeZone(tz);
  const buckets: HourBucket[] = Array.from({ length: 24 }, (_, h) => ({
    hour: h,
    label: `${h.toString().padStart(2, "0")}:00`,
    calls: 0,
    conversions: 0,
    revenue: 0,
  }));
  for (const c of calls) {
    if (c.startedAt < start) continue;
    const h = hourInTimeZone(c.startedAt, tz);
    buckets[h].calls += 1;
    buckets[h].revenue += c.revenue;
    if (c.status === "completed") buckets[h].conversions += 1;
  }
  return buckets;
}

/** N daily buckets ending today (oldest first, today last).
 *  Uses the selected demo timezone for the day boundary calculation so
 *  the 14-day chart aligns with whatever timezone the user selected. */
export function bucketDaily(calls: Call[], days: number): DayBucket[] {
  const tz = getDemoTimezone();
  const startMs = startOfDayInTimeZone(tz);
  const buckets: DayBucket[] = Array.from({ length: days }, (_, i) => {
    const d = new Date(startMs - (days - 1 - i) * DAY_MS);
    return {
      offset: days - 1 - i,
      label: i === days - 1 ? "Today" : DAY_NAMES[d.getDay()],
      calls: 0,
      conversions: 0,
      revenue: 0,
    };
  });
  for (const c of calls) {
    const dayStartMs = startOfDayInTimeZone(tz, new Date(c.startedAt));
    const offsetDays = Math.round((startMs - dayStartMs) / DAY_MS);
    if (offsetDays < 0 || offsetDays >= days) continue;
    const idx = days - 1 - offsetDays;
    buckets[idx].calls += 1;
    buckets[idx].revenue += c.revenue;
    if (c.status === "completed") buckets[idx].conversions += 1;
  }
  return buckets;
}
