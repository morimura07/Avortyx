"use client";

import { useEffect, useRef, useState } from "react";
import {
  ChevronDown,
  Eye,
  Globe,
  RefreshCw,
} from "lucide-react";
import type { DateRange } from "react-day-picker";

import { ReportsFilterPopover, type ReportFilters } from "@/components/reports/reports-filter-popover";
import { DateRangePicker } from "@/components/shared/date-range-picker";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { getDemoTimezone, setDemoTimezone } from "@/lib/demo/tz";
import { TIMEZONES as TZ_OPTIONS, TIMEZONE_BY_IANA } from "@/lib/timezones";
import { useTranslation } from "@/hooks/use-translation";
import { cn } from "@/lib/utils";

type RefreshOption =
  | "Off"
  | "Auto refresh"
  | "Every 10 s"
  | "Every 30 s"
  | "Every 1 min"
  | "Every 5 min";

const REFRESH_OPTIONS: RefreshOption[] = [
  "Off",
  "Auto refresh",
  "Every 10 s",
  "Every 30 s",
  "Every 1 min",
  "Every 5 min",
];

const REFRESH_LABEL_KEYS: Record<RefreshOption, string> = {
  "Off": "toolsUI.reports.toolbar.refreshOptions.off",
  "Auto refresh": "toolsUI.reports.toolbar.refreshOptions.auto",
  "Every 10 s": "toolsUI.reports.toolbar.refreshOptions.every10s",
  "Every 30 s": "toolsUI.reports.toolbar.refreshOptions.every30s",
  "Every 1 min": "toolsUI.reports.toolbar.refreshOptions.every1m",
  "Every 5 min": "toolsUI.reports.toolbar.refreshOptions.every5m",
};

/** How many seconds before the option fires onRefresh again. 0 = no timer. */
const REFRESH_SECONDS: Record<RefreshOption, number> = {
  Off: 0,
  "Auto refresh": 30, // sensible default for the "smart" auto mode
  "Every 10 s": 10,
  "Every 30 s": 30,
  "Every 1 min": 60,
  "Every 5 min": 300,
};

/**
 * Subtle hover override used on every outline button in the toolbar.
 *
 * shadcn's outline variant default is `hover:bg-accent hover:text-accent-foreground`,
 * which on Avortyx's dark theme flashes the button to bright teal + near-black
 * text — readable in isolation but jarring here, and easy to mistake for
 * disabled. Swap for a muted background that keeps `--foreground` text.
 */
const TOOLBAR_BTN_HOVER =
  "hover:bg-muted hover:text-foreground dark:hover:bg-muted/70";


/** Section-visibility flags driven by the toolbar's eye-dropdown. */
export interface ReportsVisibility {
  hourly: boolean;
  donut: boolean;
  perf: boolean;
  summary: boolean;
  log: boolean;
}

export const DEFAULT_REPORTS_VISIBILITY: ReportsVisibility = {
  hourly: true,
  donut: true,
  perf: true,
  summary: true,
  log: true,
};

interface ReportsToolbarProps {
  dateRange: DateRange | undefined;
  onDateRangeChange: (range: DateRange | undefined) => void;
  onRefresh: () => void;
  filters: ReportFilters;
  onFiltersChange: (filters: ReportFilters) => void;
  visibility: ReportsVisibility;
  onVisibilityChange: (next: ReportsVisibility) => void;
}

export function ReportsToolbar({
  dateRange,
  onDateRangeChange,
  onRefresh,
  filters,
  onFiltersChange,
  visibility,
  onVisibilityChange,
}: ReportsToolbarProps) {
  const { t } = useTranslation();
  // Hydrate from the shared demo-timezone store so this dropdown stays
  // in sync with the Live Monitor's picker — pick either surface and
  // every chart / KPI on the site respects the choice.
  const [tz, setTz] = useState<string>(() => {
    const iana = getDemoTimezone();
    return TIMEZONE_BY_IANA[iana]?.label ?? TZ_OPTIONS[0].label;
  });
  useEffect(() => {
    const iana = getDemoTimezone();
    const label = TIMEZONE_BY_IANA[iana]?.label;
    if (label && label !== tz) setTz(label);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const onTzChange = (label: string) => {
    setTz(label);
    // Reverse-lookup: find the IANA id for this label, write to the shared
    // demo-timezone store, then hard-reload so every chart + KPI on the
    // page re-anchors to the new timezone. Matches the Live Monitor's
    // picker behavior.
    const match = TZ_OPTIONS.find((opt) => opt.label === label);
    if (match) {
      setDemoTimezone(match.iana);
      if (typeof window !== "undefined") window.location.reload();
    }
  };
  const [refresh, setRefresh] = useState<RefreshOption>("Auto refresh");

  // Live ticking countdown: seconds remaining until the next auto-refresh fires.
  // 0 whenever the option is "Off" or no interval is active.
  const intervalSec = REFRESH_SECONDS[refresh];
  const [remaining, setRemaining] = useState<number>(intervalSec);
  // Hold the latest onRefresh in a ref so the ticking effect doesn't re-arm
  // every render just because the parent passed a fresh callback.
  const refreshRef = useRef(onRefresh);
  useEffect(() => {
    refreshRef.current = onRefresh;
  }, [onRefresh]);

  useEffect(() => {
    if (intervalSec <= 0) {
      setRemaining(0);
      return;
    }
    setRemaining(intervalSec);
    const id = window.setInterval(() => {
      setRemaining((s) => {
        if (s <= 1) {
          // Fire the refresh and rearm.
          refreshRef.current();
          return intervalSec;
        }
        return s - 1;
      });
    }, 1000);
    return () => window.clearInterval(id);
  }, [intervalSec]);

  const active = intervalSec > 0;
  const refreshLabel = t(REFRESH_LABEL_KEYS[refresh]);
  const countdownLabel = active ? `${refreshLabel} · ${remaining}s` : refreshLabel;

  // Section toggles surfaced under the eye button. Order matches the page.
  const SECTION_TOGGLES: Array<{ key: keyof ReportsVisibility; labelKey: string }> = [
    { key: "hourly",  labelKey: "toolsUI.reports.toolbar.sections.hourly" },
    { key: "donut",   labelKey: "toolsUI.reports.toolbar.sections.donut" },
    { key: "perf",    labelKey: "toolsUI.reports.toolbar.sections.perf" },
    { key: "summary", labelKey: "toolsUI.reports.toolbar.sections.summary" },
    { key: "log",     labelKey: "toolsUI.reports.toolbar.sections.log" },
  ];
  const hiddenCount = SECTION_TOGGLES.filter((s) => !visibility[s.key]).length;
  const allOn = hiddenCount === 0;

  return (
    <div className="flex flex-wrap items-center gap-2">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            className={cn(
              "gap-1.5 px-2.5",
              allOn
                ? TOOLBAR_BTN_HOVER
                : "border-accent/50 bg-accent/10 text-accent hover:bg-accent/15 hover:text-accent",
            )}
            aria-label={t("toolsUI.reports.toolbar.viewSettings")}
          >
            <Eye className="h-4 w-4" />
            {!allOn && (
              <span className="tabular-nums text-[11px] font-medium">
                {SECTION_TOGGLES.length - hiddenCount}/{SECTION_TOGGLES.length}
              </span>
            )}
            <ChevronDown className="h-3 w-3 opacity-60" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-56">
          <DropdownMenuLabel className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            {t("toolsUI.reports.toolbar.viewSettings")}
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          {SECTION_TOGGLES.map((s) => (
            <DropdownMenuCheckboxItem
              key={s.key}
              checked={visibility[s.key]}
              onCheckedChange={(v) =>
                onVisibilityChange({ ...visibility, [s.key]: Boolean(v) })
              }
              onSelect={(e) => e.preventDefault()}
            >
              {t(s.labelKey)}
            </DropdownMenuCheckboxItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onSelect={() => onVisibilityChange(DEFAULT_REPORTS_VISIBILITY)}
            disabled={allOn}
          >
            {t("toolsUI.reports.toolbar.showAll")}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <div className="ml-auto flex flex-wrap items-center gap-2">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="outline"
              size="sm"
              className={cn("gap-2", TOOLBAR_BTN_HOVER)}
            >
              <Globe className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="truncate max-w-[18rem]">{tz}</span>
              <ChevronDown className="h-3 w-3 opacity-60" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="max-h-80 w-80 overflow-y-auto">
            {TZ_OPTIONS.map((t) => (
              <DropdownMenuItem
                key={t.iana}
                onSelect={() => onTzChange(t.label)}
                className={cn(tz === t.label && "text-accent")}
              >
                {t.label}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        {/* Date-range picker with preset shortcuts + Cancel/Apply (buffered) */}
        <DateRangePicker
          value={dateRange}
          onChange={onDateRangeChange}
          className={TOOLBAR_BTN_HOVER}
        />

        <ReportsFilterPopover filters={filters} onChange={onFiltersChange} />

        <Button
          variant="outline"
          size="icon"
          className={cn("h-9 w-9", TOOLBAR_BTN_HOVER)}
          aria-label={t("toolsUI.reports.toolbar.refresh")}
          onClick={onRefresh}
        >
          <RefreshCw className="h-4 w-4" />
        </Button>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="outline"
              size="sm"
              className={cn(
                "gap-2 tabular-nums",
                // When auto-refresh is armed, tint the chip in the portal accent
                // (and the dot below pulses) so the operator sees it ticking.
                active
                  ? "border-accent/50 bg-accent/10 text-accent hover:bg-accent/15 hover:text-accent"
                  : TOOLBAR_BTN_HOVER,
              )}
            >
              {active && (
                <span
                  aria-hidden
                  className="relative inline-flex h-1.5 w-1.5"
                >
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-current opacity-60" />
                  <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-current" />
                </span>
              )}
              {countdownLabel}
              <ChevronDown className={cn("h-3 w-3", active ? "opacity-80" : "opacity-60")} />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {REFRESH_OPTIONS.map((r) => (
              <DropdownMenuItem
                key={r}
                onSelect={() => setRefresh(r)}
                className={cn(refresh === r && "text-accent")}
              >
                {t(REFRESH_LABEL_KEYS[r])}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}
