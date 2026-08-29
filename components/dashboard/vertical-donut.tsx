"use client";

import { useMemo, useState } from "react";
import { Cell, Pie, PieChart, ResponsiveContainer } from "recharts";

import { Card, CardContent } from "@/components/ui/card";
import { useTranslation } from "@/hooks/use-translation";
import { TODAY_HOURLY } from "@/lib/mock/timeseries";
import { formatNumber } from "@/lib/format";
import { useCallsStore } from "@/lib/store/calls-store";
import type { Call } from "@/lib/types";

interface VerticalDonutProps {
  /** When provided, success vs drop is counted from these calls. Otherwise the
   *  numbers come from TODAY_HOURLY (matching the default-mode KPI block). */
  calls?: Call[];
}

// Completed slice rides a soft single-hue indigo gradient (deep → bright).
// Drop slice uses the destructive red.
const SUCCESS_FILL = "url(#donut-success-grad)";
const DROP_FILL = "var(--destructive)";
const SUCCESS_SWATCH = "var(--accent)";
const DROP_SWATCH = "var(--destructive)";

export function VerticalDonut({ calls }: VerticalDonutProps = {}) {
  const { t } = useTranslation();
  // KPI snapshot — used as a fallback so the donut headline is never a
  // stark "0" while `/api/analytics/calls` is mid-flight or the caller
  // passed an empty array. Reading from the same store the topbar uses
  // keeps the two counters agreeing with each other.
  const kpis = useCallsStore((s) => s.kpis);
  const { total, completed, dropped } = useMemo(() => {
    // Preferred source: the date-range-scoped `calls` prop from the
    // parent Dashboard page. Trust that filter — do NOT layer an extra
    // "today only" cutoff on top of it, because that used to zero the
    // donut whenever the operator selected any range other than today
    // (e.g. Yesterday / Last 7d) even though every other widget on the
    // page happily rendered the same slice.
    if (calls && calls.length > 0) {
      const all = calls.length;
      const ok = calls.filter((c) => c.status === "completed").length;
      return { total: all, completed: ok, dropped: Math.max(0, all - ok) };
    }
    // Fallback 1: KPI snapshot from /api/analytics/dashboard. Keeps the
    // donut in sync with the topbar TOTAL when the paginated call log
    // hasn't loaded yet.
    if (kpis && kpis.callsToday > 0) {
      const all = kpis.callsToday;
      const ok = kpis.completedCalls || kpis.convertedCalls || 0;
      return { total: all, completed: ok, dropped: Math.max(0, all - ok) };
    }
    // Fallback 2: bundled mock (no live data anywhere). Preserves the
    // marketing-style empty-state visual instead of a bare "0" ring.
    const allMock = TODAY_HOURLY.reduce((s, p) => s + p.calls, 0);
    const okMock = TODAY_HOURLY.reduce((s, p) => s + p.conversions, 0);
    return { total: allMock, completed: okMock, dropped: Math.max(0, allMock - okMock) };
  }, [calls, kpis]);

  const slices = [
    { key: "completed", label: t("dashboard.donut.completed"), count: completed, fill: SUCCESS_FILL, swatch: SUCCESS_SWATCH },
    { key: "dropped", label: t("dashboard.donut.notConnected"), count: dropped, fill: DROP_FILL, swatch: DROP_SWATCH },
  ].filter((s) => s.count > 0);

  // Click a sector → swap the center label/count to that slice. `null` is the
  // default — the center shows the running TOTAL. Clicking the same sector
  // again (or anywhere off the chart) toggles back to TOTAL.
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const activeSlice = activeKey
    ? slices.find((s) => s.key === activeKey) ?? null
    : null;

  return (
    <Card
      className="flex h-full flex-col"
      onClick={() => setActiveKey(null)}
    >
      <CardContent className="flex flex-1 flex-col items-center justify-center gap-5 p-6">
        <div
          // Suppress the default focus-ring rectangle Recharts paints on the
          // sectors when a slice is clicked.
          className="relative h-44 w-44 [&_.recharts-wrapper:focus]:outline-none [&_.recharts-sector:focus]:outline-none [&_path:focus]:outline-none [&_svg:focus]:outline-none"
        >
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <defs>
                {/* Soft single-hue gradient tied to the active theme accent.
                    Opacity stops give a subtle dark→light arc without
                    locking us to a hardcoded hue. */}
                <linearGradient id="donut-success-grad" x1="0" y1="0" x2="1" y2="1">
                  <stop offset="0%" stopColor="var(--accent)" stopOpacity={0.65} />
                  <stop offset="60%" stopColor="var(--accent)" stopOpacity={0.9} />
                  <stop offset="100%" stopColor="var(--accent)" stopOpacity={1} />
                </linearGradient>
              </defs>
              <Pie
                data={slices}
                dataKey="count"
                nameKey="label"
                cx="50%"
                cy="50%"
                innerRadius="62%"
                outerRadius="92%"
                paddingAngle={2}
                stroke="var(--card)"
                strokeWidth={3}
                isAnimationActive
                animationDuration={500}
                activeShape={undefined}
                activeIndex={-1}
                onClick={(payload, idx, e) => {
                  (e as unknown as { stopPropagation?: () => void })?.stopPropagation?.();
                  const next = slices[idx];
                  if (!next) return;
                  setActiveKey((prev) => (prev === next.key ? null : next.key));
                }}
              >
                {slices.map((s) => (
                  <Cell
                    key={s.key}
                    fill={s.fill}
                    fillOpacity={
                      activeKey === null || s.key === activeKey ? 1 : 0.35
                    }
                    tabIndex={-1}
                    style={{ outline: "none", cursor: "pointer" }}
                  />
                ))}
              </Pie>
            </PieChart>
          </ResponsiveContainer>
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
            {activeSlice ? (
              <>
                <span
                  className="max-w-[7rem] truncate text-[10px] uppercase tracking-wider"
                  style={{ color: activeSlice.swatch }}
                >
                  {activeSlice.label}
                </span>
                <span className="text-xl font-semibold tabular-nums">
                  {formatNumber(activeSlice.count)}
                </span>
              </>
            ) : (
              <>
                <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
                  {t("dashboard.donut.total")}
                </span>
                <span className="text-xl font-semibold tabular-nums">
                  {formatNumber(total)}
                </span>
                <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
                  {t("dashboard.donut.callsSuffix")}
                </span>
              </>
            )}
          </div>
        </div>

        {/* Legend — click a row to focus that slice; click again to revert. */}
        <ul
          className="flex flex-wrap items-center justify-center gap-x-5 gap-y-2 text-sm"
          onClick={(e) => e.stopPropagation()}
        >
          <li>
            <button
              type="button"
              onClick={() =>
                setActiveKey((prev) => (prev === "completed" ? null : "completed"))
              }
              className="inline-flex items-center gap-2 rounded px-1 py-0.5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              style={{ opacity: activeKey === null || activeKey === "completed" ? 1 : 0.65 }}
              aria-pressed={activeKey === "completed"}
            >
              <span
                aria-hidden
                className="h-2.5 w-2.5 rounded-sm"
                style={{ background: SUCCESS_SWATCH }}
              />
              <span>{t("dashboard.donut.totalCalls")}</span>
              <span className="font-medium tabular-nums">{formatNumber(total)}</span>
            </button>
          </li>
          <li>
            <button
              type="button"
              onClick={() =>
                setActiveKey((prev) => (prev === "dropped" ? null : "dropped"))
              }
              className="inline-flex items-center gap-2 rounded px-1 py-0.5 text-destructive transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              style={{ opacity: activeKey === null || activeKey === "dropped" ? 1 : 0.65 }}
              aria-pressed={activeKey === "dropped"}
            >
              <span
                aria-hidden
                className="h-2.5 w-2.5 rounded-sm"
                style={{ background: DROP_SWATCH }}
              />
              <span>{t("dashboard.donut.notConnected")}</span>
              <span className="font-medium tabular-nums">{formatNumber(dropped)}</span>
            </button>
          </li>
        </ul>
      </CardContent>
    </Card>
  );
}
