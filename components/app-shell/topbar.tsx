"use client";

import * as React from "react";
import { Command, PhoneCall, PhoneIncoming, Search, Wallet } from "lucide-react";

import { NotificationsMenu } from "./notifications-menu";
import { UserMenu } from "./user-menu";
import { LanguageToggle } from "@/components/shared/language-toggle";
import { ThemeToggle } from "@/components/shared/theme-toggle";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { useTranslation } from "@/hooks/use-translation";
import { formatCurrency, formatNumber } from "@/lib/format";
import { useCallsStore } from "@/lib/store/calls-store";
import { useOnboardingStore } from "@/lib/store/onboarding-store";
import { cn } from "@/lib/utils";

export function Topbar() {
  const { t } = useTranslation();
  // Live counters now come straight from the analytics dashboard endpoint,
  // hydrated on app mount by <StoreHydrator />. Zero values render until the
  // first response lands; that's accurate, not a degraded state.
  const kpis = useCallsStore((s) => s.kpis);
  // Fall back to the calls list when the dashboard endpoint hasn't
  // hydrated (or ships zeros) so the topbar TOTAL is never dead-zero
  // while the Reports page next door clearly has data. `recent` is the
  // same slice both dashboard charts and the Call Log page consume, so
  // the fallback stays consistent with the rest of the UI.
  const recentCalls = useCallsStore((s) => s.recent);
  const callsTodayFromRecent = React.useMemo(() => {
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    const startMs = startOfToday.getTime();
    let n = 0;
    for (const c of recentCalls) if (c.startedAt >= startMs) n++;
    return n;
  }, [recentCalls]);
  const liveFromRecent = React.useMemo(() => {
    let n = 0;
    for (const c of recentCalls) if (c.status === "ringing" || c.status === "in-progress") n++;
    return n;
  }, [recentCalls]);
  // Wallet balance comes from the billing account fetched by the onboarding
  // store on mount (and refreshed after every recharge). Renders 0 until the
  // first response lands.
  const balance = useOnboardingStore((s) => s.balance);
  const liveCalls = kpis?.liveCalls || liveFromRecent;
  const totalCalls = kpis?.callsToday || callsTodayFromRecent;

  return (
    <header className="sticky top-0 z-30 border-b border-border/50 bg-background/85 backdrop-blur-xl">
      <div className="relative flex h-16 items-center gap-4 px-4 sm:px-6">
        {/* LEFT — sidebar trigger only */}
        <div className="flex items-center">
          <div className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-border/70 bg-secondary/40">
            <SidebarTrigger className="!h-8 !w-8 text-muted-foreground hover:text-foreground" />
          </div>
        </div>

        {/* CENTER — command search */}
        <div className="relative mx-auto hidden w-full max-w-lg lg:block">
          <CommandSearch placeholder={t("topbar.searchPlaceholder")} />
        </div>

        {/* RIGHT — stats + theme + notifications + identity */}
        <div className="ml-auto flex items-center gap-2 sm:gap-3">
          {/* Live stats — recharge, in-flight, total today.
              Always visible; on mobile the inner TopStat labels collapse so
              the pill stays compact (icon + value only). Values stay in
              their full form (e.g. "3,016" not "3K") at every breakpoint. */}
          <div className="inline-flex items-center gap-2 rounded-lg border border-border/70 bg-secondary/30 px-2 py-1.5 sm:gap-3 sm:px-3">
            <TopStat
              icon={Wallet}
              value={formatCurrency(balance ?? 0)}
            />
            <span aria-hidden className="h-7 w-px bg-border/70" />
            <TopStat
              icon={PhoneIncoming}
              label={t("topbar.live")}
              value={formatNumber(liveCalls)}
              live
            />
            <span aria-hidden className="h-7 w-px bg-border/70" />
            <TopStat
              icon={PhoneCall}
              label={t("topbar.total")}
              value={formatNumber(totalCalls)}
              accent
            />
          </div>

          {/* Language + theme + notifications grouped in a pill */}
          <div className="inline-flex items-center gap-1 rounded-lg border border-border/70 bg-secondary/30 p-1">
            <LanguageToggle />
            <span aria-hidden className="h-5 w-px bg-border/70" />
            <ThemeToggle variant="icon" />
            <span aria-hidden className="h-5 w-px bg-border/70" />
            <NotificationsMenu />
          </div>

          {/* Vertical separator before identity */}
          <span aria-hidden className="hidden h-7 w-px bg-border/70 sm:block" />

          <UserMenu />
        </div>
      </div>

      {/* Bottom hairline — full theme gradient fading to border so every
          accent change (solid or multi-stop) lights up the topbar edge. */}
      <div aria-hidden className="relative h-px w-full">
        <div className="absolute inset-x-0 top-0 h-px bg-border/60" />
        <div
          className="absolute left-0 top-0 h-px w-64 bg-accent-gradient"
          style={{
            maskImage: "linear-gradient(to right, black, transparent)",
            WebkitMaskImage: "linear-gradient(to right, black, transparent)",
          }}
        />
      </div>
    </header>
  );
}

/* ─────────────────────────────────────────────────────────────────── */

function CommandSearch({ placeholder }: { placeholder: string }) {
  return (
    <label className="group/cmd relative flex h-10 w-full items-center gap-2.5 rounded-lg border border-border/70 bg-secondary/30 px-3 text-sm transition-colors hover:border-accent/40 focus-within:border-accent/55 focus-within:bg-secondary/50">
      <span className="inline-flex h-6 w-6 items-center justify-center rounded-md bg-accent/10 text-accent">
        <Search className="h-3.5 w-3.5" />
      </span>
      <input
        type="search"
        placeholder={placeholder}
        className="flex-1 bg-transparent text-[13px] text-foreground placeholder:text-muted-foreground/70 focus:outline-none"
      />
      <kbd className="pointer-events-none hidden h-6 select-none items-center gap-0.5 rounded border border-border bg-card px-1.5 font-mono text-[10px] font-semibold text-muted-foreground sm:inline-flex">
        <Command className="h-3 w-3" />
        K
      </kbd>
    </label>
  );
}

/* ─────────────────────────────────────────────────────────────────── */

interface TopStatProps {
  icon: React.ElementType;
  /** Optional eyebrow label. When omitted, the value renders alone next to the icon. */
  label?: string;
  value: string;
  /** Pulses the icon when true (used for the "Live" stat). */
  live?: boolean;
  /** Renders label + value in the portal accent (matches the auto-refresh chip). */
  accent?: boolean;
}

function TopStat({
  icon: Icon,
  label,
  value,
  live = false,
  accent = false,
}: TopStatProps) {
  // Bright Won-green ramp — used everywhere on the Live stat so it draws the eye.
  const greenText = "text-[oklch(0.5_0.18_155)] dark:text-[oklch(0.78_0.18_155)]";
  const greenBg =
    "bg-[oklch(0.6_0.18_155)]/15 dark:bg-[oklch(0.78_0.18_155)]/15";

  return (
    <span className="inline-flex items-center gap-1.5 sm:gap-2">
      <span
        className={cn(
          "relative inline-flex h-6 w-6 items-center justify-center rounded-md",
          live ? `${greenBg} ${greenText}` : "bg-accent/10 text-accent",
        )}
      >
        <Icon className="h-3.5 w-3.5" />
        {live && (
          <span className="absolute -right-0.5 -top-0.5 flex h-1.5 w-1.5">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[oklch(0.6_0.18_155)] opacity-70 dark:bg-[oklch(0.78_0.18_155)]" />
            <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-[oklch(0.6_0.18_155)] dark:bg-[oklch(0.78_0.18_155)]" />
          </span>
        )}
      </span>
      {label ? (
        <span className="flex flex-col leading-tight">
          {/* Label collapses on mobile to keep the pill compact. */}
          <span
            className={cn(
              "hidden text-[10px] uppercase tracking-wider sm:inline",
              live
                ? `${greenText} font-semibold`
                : accent
                  ? "text-accent-gradient font-semibold"
                  : "text-muted-foreground",
            )}
          >
            {label}
          </span>
          <span
            className={cn(
              "tabular-nums",
              live
                ? `text-[13px] font-bold sm:text-[15px] ${greenText}`
                : accent
                  ? "text-[13px] font-bold text-accent-gradient sm:text-[15px]"
                  : "text-[12px] font-semibold text-foreground sm:text-[13px]",
            )}
          >
            {value}
          </span>
        </span>
      ) : (
        <span
          className={cn(
            "text-xs font-semibold tabular-nums sm:text-sm",
            accent ? "text-accent-gradient" : "text-foreground",
          )}
        >
          {value}
        </span>
      )}
    </span>
  );
}
