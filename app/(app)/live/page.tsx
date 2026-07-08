"use client";

import { useEffect, useState } from "react";
import { CalendarDays, ChevronDown, Clock, Globe, Headphones, Radio } from "lucide-react";

import { LiveControls } from "@/components/live/live-controls";
import { LiveDialerView } from "@/components/live/live-dialer-view";
import { LiveRadar } from "@/components/live/live-radar";
import { LiveStreamPanel } from "@/components/live/live-stream-panel";
import { RoutingPath } from "@/components/live/routing-path";
import { SessionMeter } from "@/components/live/session-meter";
import { LiveBadge } from "@/components/shared/live-badge";
import { PageHeader } from "@/components/shared/page-header";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useLiveSocket } from "@/hooks/use-live-socket";
import { useTranslation } from "@/hooks/use-translation";
import { DEFAULT_DEMO_TIMEZONE, getDemoTimezone, setDemoTimezone } from "@/lib/demo/tz";
import { TIMEZONES, TIMEZONE_BY_IANA } from "@/lib/timezones";
import { cn } from "@/lib/utils";

export default function LivePage() {
  const { t, locale } = useTranslation();
  const [paused, setPaused] = useState(false);
  const [tab, setTab] = useState<"calls" | "dialer">("calls");
  const { inFlight, history, totals } = useLiveSocket({ paused });

  // User-selectable timezone for the date + clock chips. Defaults to EST
  // per the client's operational default, persisted in localStorage so
  // the choice survives reloads. Deferred read after mount so SSR and
  // the first client paint don't disagree.
  const [timezone, setTimezone] = useState<string>(DEFAULT_DEMO_TIMEZONE);
  useEffect(() => {
    const stored = getDemoTimezone();
    if (TIMEZONE_BY_IANA[stored]) setTimezone(stored);
  }, []);
  const onTimezoneChange = (iana: string) => {
    setTimezone(iana);
    setDemoTimezone(iana);
    // Force a full reload so every corpus bucket + chart + KPI re-anchors
    // to the newly-selected timezone. The demo router keys its corpus on
    // the selected tz, but React state already in memory (topbar TOTAL,
    // reports chart, dashboard sparklines) won't refetch on its own.
    if (typeof window !== "undefined") window.location.reload();
  };
  const timezoneLabel = TIMEZONE_BY_IANA[timezone]?.label ?? timezone;

  // Today's date chip — rendered in the selected timezone (not the user's
  // PC local time). Deferred to after mount for SSR safety.
  const [todayLabel, setTodayLabel] = useState("");
  useEffect(() => {
    setTodayLabel(
      new Date().toLocaleDateString(locale, {
        weekday: "short",
        month: "short",
        day: "numeric",
        year: "numeric",
        timeZone: timezone,
      }),
    );
  }, [locale, timezone]);

  // Live wall-clock in the selected timezone — ticks once per second so
  // the page reads as genuinely "streaming right now" for whatever
  // timezone the operator selects.
  const [timeLabel, setTimeLabel] = useState("");
  useEffect(() => {
    const render = () => {
      setTimeLabel(
        new Date().toLocaleTimeString(locale, {
          hour: "numeric",
          minute: "2-digit",
          second: "2-digit",
          // Force 12-hour with AM/PM regardless of locale (Japanese
          // default would otherwise be 24-hour — "13:57:09" not "1:57 PM").
          hour12: true,
          timeZone: timezone,
        }),
      );
    };
    render();
    const id = window.setInterval(render, 1000);
    return () => window.clearInterval(id);
  }, [locale, timezone]);

  // Featured = longest-running in-flight call, falls back to most recent settled.
  const featured =
    inFlight.length > 0
      ? [...inFlight].sort((a, b) => a.startedAt - b.startedAt)[0]
      : history[0] ?? null;

  return (
    <>
      <PageHeader
        title={t("page.live.title")}
        description={t("page.live.description")}
        actions={
          <>
            <span
              className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card/60 px-2.5 py-0.5 text-[11px] font-medium text-muted-foreground"
              suppressHydrationWarning
            >
              <CalendarDays className="h-3 w-3 text-accent" />
              {todayLabel || "—"}
            </span>
            <span
              className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card/60 px-2.5 py-0.5 font-mono text-[11px] font-medium tabular-nums text-muted-foreground"
              suppressHydrationWarning
              aria-label="Current time"
            >
              <Clock className="h-3 w-3 text-accent" />
              {timeLabel || "—"}
            </span>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  aria-label="Select timezone"
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-full border border-border bg-card/60 px-2.5 py-0.5 text-[11px] font-medium text-muted-foreground transition-colors",
                    "hover:bg-secondary/40 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  )}
                >
                  <Globe className="h-3 w-3 text-accent" />
                  <span className="max-w-[16rem] truncate">{timezoneLabel}</span>
                  <ChevronDown className="h-3 w-3 opacity-60" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="max-h-80 w-80 overflow-y-auto">
                {TIMEZONES.map((tz) => (
                  <DropdownMenuItem
                    key={tz.iana}
                    onSelect={() => onTimezoneChange(tz.iana)}
                    className={cn(timezone === tz.iana && "text-accent")}
                  >
                    {tz.label}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
            <LiveBadge label={paused ? t("liveUI.badge.paused") : t("liveUI.badge.streaming")} />
            {tab === "calls" && (
              <LiveControls paused={paused} onTogglePause={() => setPaused((p) => !p)} />
            )}
          </>
        }
      />

      <Tabs value={tab} onValueChange={(v) => setTab(v as "calls" | "dialer")} className="space-y-4">
        <TabsList>
          <TabsTrigger value="calls" className="gap-2">
            <Radio className="h-3.5 w-3.5" /> Calls
          </TabsTrigger>
          <TabsTrigger value="dialer" className="gap-2">
            <Headphones className="h-3.5 w-3.5" /> Dialer
          </TabsTrigger>
        </TabsList>

        <TabsContent value="calls" className="space-y-4">
          <LiveRadar inFlight={inFlight} featured={featured} totals={totals} />

          {/* Bento — 12 col */}
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
            <div className="lg:col-span-8">
              <LiveStreamPanel inFlight={inFlight} history={history} />
            </div>
            <div className="space-y-4 lg:col-span-4">
              <RoutingPath call={featured} />
              <SessionMeter totals={totals} inFlightCount={inFlight.length} />
            </div>
          </div>
        </TabsContent>

        <TabsContent value="dialer">
          <LiveDialerView />
        </TabsContent>
      </Tabs>
    </>
  );
}
