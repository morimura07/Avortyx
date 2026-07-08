/**
 * Shared demo timezone — single source of truth for what timezone every
 * data + display surface (charts, KPIs, cumulative filters, timestamps)
 * should honor. Read by:
 *   - lib/demo/fixtures/calls.ts (corpus anchor + today filter)
 *   - lib/dashboard-buckets.ts (hourly / daily chart bucketing)
 *   - components/reports/hourly-distribution.tsx (reports chart bucketing)
 *
 * Written by whichever timezone picker the user interacts with — the
 * Live Monitor's `Globe` chip, the Reports toolbar's timezone dropdown,
 * etc. All read/write the same localStorage key so the pages stay
 * mutually consistent.
 */

const STORAGE_KEY = "avortyx.demo.timezone";
export const DEFAULT_DEMO_TIMEZONE = "America/New_York";

/** Read the currently selected demo timezone. SSR-safe: returns the
 *  default when `window` isn't available. */
export function getDemoTimezone(): string {
  if (typeof window === "undefined") return DEFAULT_DEMO_TIMEZONE;
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    return stored && stored.length > 0 ? stored : DEFAULT_DEMO_TIMEZONE;
  } catch {
    return DEFAULT_DEMO_TIMEZONE;
  }
}

/** Persist the selected timezone. Called from the Live Monitor picker and
 *  the Reports toolbar so they stay in sync. */
export function setDemoTimezone(tz: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, tz);
  } catch {
    /* quota / private mode — ignore */
  }
}

/** Return midnight of "today" in the given timezone, expressed as UTC ms.
 *  Works for any IANA timezone (including DST-observing ones) by asking
 *  Intl.DateTimeFormat for the current wall-clock parts in that zone and
 *  reverse-engineering the offset. */
export function startOfDayInTimeZone(tz: string, ref: Date = new Date()): number {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  const parts = fmt.formatToParts(ref);
  const get = (t: string) => {
    const p = parts.find((p) => p.type === t)?.value ?? "0";
    return parseInt(p, 10);
  };
  const y = get("year");
  const m = get("month");
  const d = get("day");
  const hh = get("hour") % 24;
  const mm = get("minute");
  const ss = get("second");
  const asIfUtc = Date.UTC(y, m - 1, d, hh, mm, ss);
  const offsetMs = asIfUtc - ref.getTime();
  return Date.UTC(y, m - 1, d, 0, 0, 0) - offsetMs;
}

/** Return the hour-of-day (0–23) of a timestamp expressed in the given
 *  timezone. Used by chart-bucketing code to place calls at the correct
 *  hour in the user's selected timezone. */
export function hourInTimeZone(ts: number, tz: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hour: "2-digit",
    hour12: false,
  }).formatToParts(new Date(ts));
  const h = parseInt(parts.find((p) => p.type === "hour")?.value ?? "0", 10);
  return Number.isFinite(h) ? h % 24 : 0;
}
