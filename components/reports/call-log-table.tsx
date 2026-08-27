"use client";

import * as React from "react";
import {
  Ban,
  Copy,
  DollarSign,
  Download,
  Pause,
  PhoneOff,
  Play,
  Plus,
  Search,
  Settings,
  Tag,
} from "lucide-react";
import { toast } from "sonner";

import { ExportMenu } from "@/components/shared/export-menu";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Pagination } from "@/components/shared/pagination";
import { dateStamped, downloadRows, type ExportColumn, type ExportFormat } from "@/lib/export";
import { formatCurrency, formatHMS, toE164 } from "@/lib/format";
import type { Call, CallStatus } from "@/lib/types";
import { useTranslation } from "@/hooks/use-translation";
import { cn } from "@/lib/utils";

type ColumnKey =
  | "campaign"
  | "publisher"
  | "caller"
  | "dialed"
  | "buyer"
  | "revenue"
  | "payout"
  | "ttc"
  | "duration"
  | "hangUp"
  | "tag"
  | "status"
  | "failReason"
  | "recording";

const COLUMNS: Array<{ id: ColumnKey; label: string }> = [
  { id: "campaign", label: "Campaign" },
  { id: "publisher", label: "Publisher" },
  { id: "caller", label: "Caller ID" },
  { id: "dialed", label: "Dialed" },
  { id: "buyer", label: "Buyer" },
  { id: "revenue", label: "Revenue" },
  { id: "payout", label: "Payout" },
  { id: "ttc", label: "TTC" },
  { id: "duration", label: "Duration" },
  { id: "hangUp", label: "Hang up" },
  { id: "tag", label: "Tag" },
  { id: "status", label: "Status" },
  { id: "failReason", label: "Fail reason" },
  { id: "recording", label: "Recording" },
];

const COLUMN_LABEL_KEYS: Record<ColumnKey, string> = {
  campaign: "toolsUI.reports.callLog.columns.campaign",
  publisher: "toolsUI.reports.callLog.columns.publisher",
  caller: "toolsUI.reports.callLog.columns.callerId",
  dialed: "toolsUI.reports.callLog.columns.dialed",
  buyer: "toolsUI.reports.callLog.columns.buyer",
  revenue: "toolsUI.reports.callLog.columns.revenue",
  payout: "toolsUI.reports.callLog.columns.payout",
  ttc: "toolsUI.reports.callLog.columns.ttc",
  duration: "toolsUI.reports.callLog.columns.duration",
  hangUp: "toolsUI.reports.callLog.columns.hangUp",
  tag: "toolsUI.reports.callLog.columns.tag",
  status: "toolsUI.reports.callLog.columns.status",
  failReason: "toolsUI.reports.callLog.columns.failReason",
  recording: "toolsUI.reports.callLog.columns.recording",
};

const STATUS_LABEL_KEYS: Record<CallStatus, string> = {
  ringing: "toolsUI.reports.callLog.statusLabel.ringing",
  "in-progress": "toolsUI.reports.callLog.statusLabel.live",
  completed: "toolsUI.reports.callLog.statusLabel.completed",
  missed: "toolsUI.reports.callLog.statusLabel.missed",
  rejected: "toolsUI.reports.callLog.statusLabel.rejected",
  failed: "toolsUI.reports.callLog.statusLabel.failed",
};

const ALL_VISIBLE: Record<ColumnKey, boolean> = COLUMNS.reduce(
  (acc, c) => ({ ...acc, [c.id]: true }),
  {} as Record<ColumnKey, boolean>,
);

function timeLabel(ts: number) {
  const d = new Date(ts);
  const month = d.toLocaleString("en-US", { month: "short" });
  const day = d.getDate();
  let h = d.getHours();
  const m = d.getMinutes().toString().padStart(2, "0");
  const s = d.getSeconds().toString().padStart(2, "0");
  const ampm = h >= 12 ? "PM" : "AM";
  h = h % 12 || 12;
  return `${month} ${day}, ${h}:${m}:${s} ${ampm}`;
}

const STATUS_LABEL_FALLBACK: Record<CallStatus, string> = {
  ringing: "Ringing",
  "in-progress": "Live",
  completed: "Completed",
  missed: "Missed",
  rejected: "Rejected",
  failed: "Failed",
};

function statusVariant(s: CallStatus): React.ComponentProps<typeof Badge>["variant"] {
  if (s === "completed") return "success";
  if (s === "in-progress" || s === "ringing") return "default";
  if (s === "missed") return "warning";
  return "destructive";
}


/** Stable hash so derived fields (TTC, fail reason) don't reshuffle on render. */
function callHash(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) {
    h = ((h << 5) - h + id.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

/**
 * Time-to-connect derived per status:
 *  - connected calls → 1-6s typical SIP handshake + ring-pickup
 *  - missed         → 20-39s (caller waited through the no-answer timeout)
 *  - rejected       → near-instant (1-4s)
 *  - failed         → near-instant (0-2s)
 */
function getTTCSeconds(c: Call): number {
  const h = callHash(c.id);
  switch (c.status) {
    case "completed":
      return 1 + (h % 6);
    case "in-progress":
      return 1 + (h % 4);
    case "ringing":
      return 1 + (h % 3);
    case "missed":
      return 20 + (h % 20);
    case "rejected":
      return 1 + (h % 4);
    case "failed":
      return h % 3;
  }
}

const FAIL_REASONS: Partial<Record<CallStatus, string[]>> = {
  missed: ["No answer", "Caller hung up", "Timed out"],
  rejected: ["Buyer rejected", "Filter blocked", "Daily cap"],
  failed: ["Carrier error", "Network error", "Invalid number"],
};

function getFailReason(c: Call): string {
  const reasons = FAIL_REASONS[c.status];
  if (!reasons) return "";
  return reasons[callHash(c.id) % reasons.length];
}

/**
 * Hang-up side per call. Derived deterministically from the call id so the
 * same row always shows the same direction across renders/refresh.
 *
 *   caller   — the caller hung up
 *   callee   — the buyer / agent hung up
 *   carrier  — the call dropped (network)
 *   open     — never connected (no hang-up to attribute)
 */
type HangUpSide = "caller" | "callee" | "carrier" | "open";

function getHangUpSide(c: Call): HangUpSide {
  if (c.status === "ringing" || c.status === "in-progress") return "open";
  if (c.status === "failed") return "carrier";
  // For completed / missed / rejected: split 60/40 caller-vs-callee by hash.
  return callHash(c.id) % 10 < 6 ? "caller" : "callee";
}

const HANG_UP_LABEL: Record<HangUpSide, string> = {
  caller: "Caller hung up",
  callee: "Buyer hung up",
  carrier: "Carrier drop",
  open: "—",
};

/** Predefined tag pool — the per-call set is a deterministic 0-2 slice. */
const TAG_POOL = ["High intent", "Qualified", "Spanish", "Repeat", "VIP", "New lead"];

function getTags(c: Call): string[] {
  const h = callHash(c.id);
  const count = h % 4; // 0..3 tags, biased toward 0-1
  if (count === 0) return [];
  const out: string[] = [];
  for (let i = 0; i < count; i++) {
    const t = TAG_POOL[(h + i * 7) % TAG_POOL.length];
    if (!out.includes(t)) out.push(t);
  }
  return out;
}

/** Single source of truth for export cell values. Numbers stay numeric. */
function logCellValue(c: Call, key: ColumnKey): number | string {
  switch (key) {
    case "campaign":
      return c.campaignName;
    case "publisher":
      return c.publisherName ?? "";
    case "caller":
      return toE164(c.callerNumber);
    case "dialed":
      return toE164(c.destinationNumber);
    case "buyer":
      return c.buyerName ?? "";
    case "revenue":
      return c.revenue;
    case "payout":
      return c.payout;
    case "ttc":
      return formatHMS(getTTCSeconds(c));
    case "duration":
      return formatHMS(c.durationSec);
    case "hangUp":
      return HANG_UP_LABEL[getHangUpSide(c)];
    case "tag":
      return getTags(c).join(", ");
    case "status":
      return STATUS_LABEL_FALLBACK[c.status];
    case "failReason":
      return getFailReason(c);
    case "recording":
      return c.recordingUrl ? "yes" : "";
  }
}

interface CallLogTableProps {
  calls: Call[];
  /** Optional limit for the visible rows (default 50). */
  limit?: number;
}

export function CallLogTable({ calls, limit = 50 }: CallLogTableProps) {
  const { t } = useTranslation();
  const [query, setQuery] = React.useState("");
  const [columns, setColumns] = React.useState<Record<ColumnKey, boolean>>(ALL_VISIBLE);
  const [pageSize, setPageSize] = React.useState<number>(limit);
  const [page, setPage] = React.useState(0);

  // ── Inline recording playback ──────────────────────────────────────
  // The Recording column's Play button was previously a decorative icon
  // with no onClick — clicking it did nothing, which is what the client
  // flagged as "record button is not active". We hoist a single <audio>
  // element to the table and route every row's button through it so
  // only one recording plays at a time (pauses the previous when a new
  // row is clicked, toggles pause when the same row is re-clicked).
  const audioRef = React.useRef<HTMLAudioElement | null>(null);
  const [playingId, setPlayingId] = React.useState<string | null>(null);
  const togglePlay = React.useCallback((call: Call) => {
    if (!call.recordingUrl) return;
    const el = audioRef.current;
    if (!el) return;
    if (playingId === call.id) {
      el.pause();
      setPlayingId(null);
      return;
    }
    // Flip the UI to "playing" IMMEDIATELY so the button reads as Pause
    // the instant the user clicks, even before the audio starts streaming.
    // The <audio> element's `pause`/`ended`/`error` events (below) roll
    // the state back if playback never actually begins.
    setPlayingId(call.id);
    el.src = call.recordingUrl;
    el.currentTime = 0;
    void el.play().catch(() => {
      // Autoplay policy, CORS block, or 4xx/5xx from the host — surface a
      // toast so the client understands the button did fire, and clear
      // the playing state so the icon flips back to Play.
      setPlayingId((cur) => (cur === call.id ? null : cur));
      toast.error("Recording unavailable");
    });
  }, [playingId]);
  const onAudioEnded = React.useCallback(() => setPlayingId(null), []);
  const onAudioPause = React.useCallback(() => {
    // Fires whenever playback stops for any reason — user hit Pause, the
    // element was interrupted, or the track ran out. Keep the UI in sync.
    setPlayingId((cur) => {
      const el = audioRef.current;
      if (!el) return cur;
      return el.paused ? null : cur;
    });
  }, []);
  const onAudioError = React.useCallback(() => {
    setPlayingId(null);
    toast.error(t("toolsUI.reports.callLog.recording.unavailable") ?? "Recording unavailable");
  }, [t]);

  // Reset to page 0 whenever the result set or page size changes so we never
  // sit past the end of the filtered list.
  React.useEffect(() => {
    setPage(0);
  }, [query, pageSize, calls.length]);

  const colSpan = 2 + COLUMNS.filter((c) => columns[c.id]).length; // +Call date +actions menu
  const toggleColumn = (id: ColumnKey) =>
    setColumns((v) => ({ ...v, [id]: !v[id] }));

  const filtered = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    const sorted = [...calls].sort((a, b) => b.startedAt - a.startedAt);
    return q
      ? sorted.filter((c) =>
          `${c.campaignName} ${c.publisherName ?? ""} ${c.buyerName ?? ""} ${c.callerNumber} ${c.destinationNumber}`
            .toLowerCase()
            .includes(q),
        )
      : sorted;
  }, [calls, query]);

  const visible = React.useMemo(
    () => filtered.slice(page * pageSize, page * pageSize + pageSize),
    [filtered, page, pageSize],
  );

  const onExport = (format: ExportFormat) => {
    const dateCol: ExportColumn<Call> = {
      label: t("toolsUI.reports.callLog.columns.callDate"),
      value: (c) => new Date(c.startedAt).toISOString(),
    };
    const dataCols: ExportColumn<Call>[] = COLUMNS.filter((c) => columns[c.id]).map((c) => ({
      label: t(COLUMN_LABEL_KEYS[c.id]),
      value: (row) => logCellValue(row, c.id),
    }));
    downloadRows(format, [dateCol, ...dataCols], visible, dateStamped("vortyx-call-log"), "Call log");
    toast.success(t("toolsUI.reports.callLog.toastExport").replace("{count}", String(visible.length)).replace("{format}", format.toUpperCase()));
  };

  return (
    <Card className="overflow-hidden p-0">
      {/* Section title */}
      <div className="flex items-center justify-between gap-2 border-b border-border px-6 py-4">
        <div className="text-sm font-semibold text-foreground">{t("toolsUI.reports.callLog.title")}</div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t("toolsUI.reports.callLog.searchPlaceholder")}
              className="h-8 w-56 pl-7 text-xs"
            />
          </div>
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="ghost" size="icon" className="h-8 w-8" aria-label={t("toolsUI.reports.callLog.columnSettings")}>
                <Settings className="h-4 w-4" />
              </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-56 p-0">
              <div className="flex items-center justify-between border-b border-border px-3 py-2">
                <span className="text-sm font-semibold">{t("toolsUI.callLogs.toolbar.columns")}</span>
                <button
                  type="button"
                  onClick={() => setColumns(ALL_VISIBLE)}
                  className="text-xs text-muted-foreground transition-colors hover:text-foreground"
                >
                  {t("toolsUI.reports.callLog.showAll")}
                </button>
              </div>
              <div className="max-h-72 overflow-y-auto px-2 py-2">
                {COLUMNS.map((col) => {
                  const id = `log-col-${col.id}`;
                  return (
                    <Label
                      key={col.id}
                      htmlFor={id}
                      className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm font-normal hover:bg-secondary/50"
                    >
                      <Checkbox
                        id={id}
                        checked={columns[col.id]}
                        onCheckedChange={() => toggleColumn(col.id)}
                      />
                      <span>{t(COLUMN_LABEL_KEYS[col.id])}</span>
                    </Label>
                  );
                })}
              </div>
            </PopoverContent>
          </Popover>
          <ExportMenu onExport={onExport}>
            <Button variant="ghost" size="icon" className="h-8 w-8" aria-label={t("toolsUI.callLogs.toolbar.export")}>
              <Download className="h-4 w-4" />
            </Button>
          </ExportMenu>
        </div>
      </div>

      <CardContent className="p-0">
        <div className="overflow-x-auto">
          <Table className="min-w-[1100px]">
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="pl-6">{t("toolsUI.reports.callLog.columns.callDate")}</TableHead>
                {columns.campaign && <TableHead>{t("toolsUI.reports.callLog.columns.campaign")}</TableHead>}
                {columns.publisher && <TableHead>{t("toolsUI.reports.callLog.columns.publisher")}</TableHead>}
                {columns.caller && <TableHead>{t("toolsUI.reports.callLog.columns.callerId")}</TableHead>}
                {columns.dialed && <TableHead>{t("toolsUI.reports.callLog.columns.dialed")}</TableHead>}
                {columns.buyer && <TableHead>{t("toolsUI.reports.callLog.columns.buyer")}</TableHead>}
                {columns.revenue && <TableHead className="text-right">{t("toolsUI.reports.callLog.columns.revenue")}</TableHead>}
                {columns.payout && <TableHead className="text-right">{t("toolsUI.reports.callLog.columns.payout")}</TableHead>}
                {columns.ttc && <TableHead>{t("toolsUI.reports.callLog.columns.ttc")}</TableHead>}
                {columns.duration && <TableHead>{t("toolsUI.reports.callLog.columns.duration")}</TableHead>}
                {columns.hangUp && <TableHead className="text-center">{t("toolsUI.reports.callLog.columns.hangUp")}</TableHead>}
                {columns.tag && <TableHead className="text-center">{t("toolsUI.reports.callLog.columns.tag")}</TableHead>}
                {columns.status && <TableHead>{t("toolsUI.reports.callLog.columns.status")}</TableHead>}
                {columns.failReason && <TableHead>{t("toolsUI.reports.callLog.columns.failReason")}</TableHead>}
                {columns.recording && <TableHead>{t("toolsUI.reports.callLog.columns.rec")}</TableHead>}
                <TableHead className="pr-6">{t("toolsUI.reports.callLog.columns.action")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visible.length === 0 ? (
                <TableRow className="hover:bg-transparent">
                  <TableCell colSpan={colSpan} className="pl-6 py-8 text-center text-sm text-muted-foreground">
                    {t("toolsUI.reports.callLog.empty")}
                  </TableCell>
                </TableRow>
              ) : (
                visible.map((c) => {
                  const profit = c.revenue - c.payout;
                  return (
                    <TableRow key={c.id}>
                      <TableCell className="pl-6 whitespace-nowrap font-mono text-xs text-muted-foreground tabular-nums">
                        {timeLabel(c.startedAt)}
                      </TableCell>
                      {columns.campaign && (
                        <TableCell className="whitespace-nowrap font-medium">{c.campaignName}</TableCell>
                      )}
                      {columns.publisher && (
                        <TableCell className="whitespace-nowrap text-muted-foreground">
                          {c.publisherName ?? "—"}
                        </TableCell>
                      )}
                      {columns.caller && (
                        <TableCell className="whitespace-nowrap font-mono text-xs">
                          {toE164(c.callerNumber)}
                        </TableCell>
                      )}
                      {columns.dialed && (
                        <TableCell className="whitespace-nowrap font-mono text-xs">
                          {toE164(c.destinationNumber)}
                        </TableCell>
                      )}
                      {columns.buyer && (
                        <TableCell className="whitespace-nowrap text-muted-foreground">
                          {c.buyerName ?? "—"}
                        </TableCell>
                      )}
                      {columns.revenue && (
                        <TableCell className="text-right tabular-nums">
                          {formatCurrency(c.revenue, true)}
                        </TableCell>
                      )}
                      {columns.payout && (
                        <TableCell className="text-right tabular-nums">
                          {formatCurrency(c.payout, true)}
                          {profit !== 0 && (
                            <span
                              className={cn(
                                "ml-1 text-[10px]",
                                profit < 0 ? "text-destructive" : "text-[color:var(--success)]",
                              )}
                            >
                              ({profit < 0 ? "" : "+"}
                              {formatCurrency(profit, true)})
                            </span>
                          )}
                        </TableCell>
                      )}
                      {columns.ttc && (
                        <TableCell className="font-mono tabular-nums">
                          {formatHMS(getTTCSeconds(c))}
                        </TableCell>
                      )}
                      {columns.duration && (
                        <TableCell className="font-mono tabular-nums">
                          {formatHMS(c.durationSec)}
                        </TableCell>
                      )}
                      {columns.hangUp && (
                        <TableCell className="text-center">
                          <HangUpCell call={c} />
                        </TableCell>
                      )}
                      {columns.tag && (
                        <TableCell className="text-center">
                          <TagCell call={c} />
                        </TableCell>
                      )}
                      {columns.status && (
                        <TableCell>
                          <Badge variant={statusVariant(c.status)}>{t(STATUS_LABEL_KEYS[c.status])}</Badge>
                        </TableCell>
                      )}
                      {columns.failReason && (
                        <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                          {getFailReason(c) || "—"}
                        </TableCell>
                      )}
                      {columns.recording && (
                        <TableCell>
                          {c.recordingUrl ? (
                            <Button
                              variant="ghost"
                              size="icon"
                              className={cn(
                                "h-7 w-7",
                                playingId === c.id && "bg-accent/15 text-accent hover:bg-accent/20 hover:text-accent",
                              )}
                              aria-label={t("toolsUI.reports.callLog.actions.playRecording")}
                              aria-pressed={playingId === c.id}
                              onClick={() => togglePlay(c)}
                            >
                              {playingId === c.id ? (
                                <Pause className="h-3.5 w-3.5" />
                              ) : (
                                <Play className="h-3.5 w-3.5" />
                              )}
                            </Button>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </TableCell>
                      )}
                      <TableCell className="pr-6">
                        <CallRowActions call={c} />
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </div>
        <div className="border-t border-border px-6 py-3">
          <Pagination
            page={page}
            pageSize={pageSize}
            total={filtered.length}
            onPage={setPage}
            onPageSize={setPageSize}
          />
        </div>
        {/* Shared player driven by the row-level Play buttons above.
            preload="none" so we don't fetch until the user clicks. */}
        <audio
          ref={audioRef}
          onEnded={onAudioEnded}
          onPause={onAudioPause}
          onError={onAudioError}
          preload="none"
          className="hidden"
        />
      </CardContent>
    </Card>
  );
}

/* ─────────────────────────────────────────────────────────────────── */

/**
 * Hang-up indicator — a phone-with-cross icon tinted by who hung up first.
 * Caller-hang-ups read as warm (caller dropped early — possible filter
 * issue), buyer-hang-ups read as cool (normal close), carrier drops red.
 */
function HangUpCell({ call }: { call: Call }) {
  const side = getHangUpSide(call);
  if (side === "open") {
    return (
      <span className="inline-block h-3 w-3 rounded-full bg-muted" aria-label="No hang-up" />
    );
  }
  const tone =
    side === "caller"
      ? "text-[oklch(0.82_0.16_75)]"
      : side === "callee"
        ? "text-[oklch(0.78_0.14_220)]"
        : "text-destructive";
  return (
    <span
      title={HANG_UP_LABEL[side]}
      className={cn("inline-flex h-7 w-7 items-center justify-center rounded-md", tone)}
    >
      <PhoneOff className="h-3.5 w-3.5" />
    </span>
  );
}

/**
 * Tag cell — renders the existing tag chips inline and a "+" button to
 * surface the add-tag affordance. Stays compact in the column.
 */
function TagCell({ call }: { call: Call }) {
  const { t } = useTranslation();
  const tags = getTags(call);
  return (
    <div className="inline-flex items-center gap-1">
      {tags.map((tagValue) => (
        <span
          key={tagValue}
          className="inline-flex items-center rounded-md border border-border bg-secondary/40 px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground"
        >
          {tagValue}
        </span>
      ))}
      <button
        type="button"
        aria-label={t("toolsUI.reports.callLog.actions.addTagAria").replace("{id}", call.id)}
        onClick={() => toast.info(t("toolsUI.reports.callLog.actions.tagSoon"))}
        className="inline-flex h-5 w-5 items-center justify-center rounded-md border border-dashed border-border text-muted-foreground transition-colors hover:border-accent/50 hover:text-accent"
      >
        {tags.length === 0 ? <Tag className="h-3 w-3" /> : <Plus className="h-3 w-3" />}
      </button>
    </div>
  );
}

/** Three inline icon actions per row: copy caller, block caller, bill/adjust. */
function CallRowActions({ call }: { call: Call }) {
  const { t } = useTranslation();
  const caller = toE164(call.callerNumber);

  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(caller);
      toast.success(t("toolsUI.reports.callLog.actions.toastCopied").replace("{number}", caller));
    } catch {
      toast.error(t("toolsUI.reports.callLog.actions.toastCopyError"));
    }
  };

  const onBlock = () => {
    toast.success(t("toolsUI.reports.callLog.actions.toastBlocked").replace("{number}", caller), {
      description: t("toolsUI.reports.callLog.actions.toastBlockedDesc"),
    });
  };

  const onBill = () => {
    const reason = getFailReason(call);
    const ttc = formatHMS(getTTCSeconds(call));
    if (call.status === "completed" || call.status === "in-progress") {
      toast.success(t("toolsUI.reports.callLog.actions.toastPayoutReview").replace("{number}", caller), {
        description: t("toolsUI.reports.callLog.actions.toastPayoutReviewDesc")
          .replace("{payout}", formatCurrency(call.payout, true))
          .replace("{ttc}", ttc),
      });
    } else {
      toast.success(t("toolsUI.reports.callLog.actions.toastBilledMissed").replace("{number}", caller), {
        description: t("toolsUI.reports.callLog.actions.toastBilledMissedDesc")
          .replace("{reason}", reason || t("toolsUI.reports.callLog.actions.noConnect"))
          .replace("{ttc}", ttc),
      });
    }
  };

  return (
    <div className="inline-flex items-center gap-0.5">
      <Button
        variant="ghost"
        size="icon"
        className="h-7 w-7"
        aria-label={t("toolsUI.reports.callLog.actions.copyCaller")}
        onClick={onCopy}
      >
        <Copy className="h-3.5 w-3.5" />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        className="h-7 w-7 text-muted-foreground hover:text-destructive"
        aria-label={t("toolsUI.reports.callLog.actions.blockCaller")}
        onClick={onBlock}
      >
        <Ban className="h-3.5 w-3.5" />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        className="h-7 w-7 text-muted-foreground hover:text-[color:var(--success)]"
        aria-label={t("toolsUI.reports.callLog.actions.billAdjust")}
        onClick={onBill}
      >
        <DollarSign className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
}
