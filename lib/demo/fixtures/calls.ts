/**
 * Call CDR generator + analytics fixtures.
 *
 * The demo dashboard needs heavy volume + a clean business-hours bell
 * curve for visual impact (sketched by the client: low overnight, climbing
 * through morning, sharp peak around 3–4pm, taper into evening).
 *
 * Today gets ~3,000 calls; each of the past 13 days gets ~200 calls so
 * the 14-day chart reads full. Calls are generated once and cached in
 * module memory — not localStorage — so we don't blow the storage quota.
 */

import { makeRng, pick, intRange, range, chance } from "../rng";
import { currentBucket, bucketInt, bucketRange } from "../bucket";
import { getDemoTimezone, startOfDayInTimeZone } from "../tz";

const DAY = 24 * 60 * 60 * 1000;
const HOUR = 60 * 60 * 1000;

const AREA_CODES = [
  "212", "415", "713", "404", "305", "303", "617", "773", "602", "206",
  "619", "512", "214", "503", "702", "615", "904", "210", "480", "813",
  "832", "972", "469", "646", "718", "323", "747", "424", "510", "925",
];
const STATES = ["TX", "CA", "FL", "NY", "PA", "OH", "IL", "GA", "NC", "MI", "WA", "AZ", "MA", "VA", "NJ", "CO"];

const CAMPAIGN_REFS = [
  { id: "c_health_001", name: "Medicare Open Enrollment 2026", payout: 65, weight: 16 },
  { id: "c_health_002", name: "ACA Subsidy Verification", payout: 55, weight: 12 },
  { id: "c_auto_001", name: "Auto Insurance — High Intent", payout: 42, weight: 18 },
  { id: "c_home_001", name: "Roofing Storm Damage", payout: 92, weight: 8 },
  { id: "c_home_002", name: "HVAC Installation Leads", payout: 75, weight: 10 },
  { id: "c_solar_001", name: "Solar — Homeowner 700+ FICO", payout: 110, weight: 7 },
  { id: "c_legal_001", name: "Mass Tort Intake — Talc", payout: 320, weight: 3 },
  { id: "c_legal_002", name: "Personal Injury Auto", payout: 180, weight: 5 },
  { id: "c_fin_001", name: "Debt Relief Consultation", payout: 58, weight: 11 },
];
const TOTAL_CAMPAIGN_WEIGHT = CAMPAIGN_REFS.reduce((s, c) => s + c.weight, 0);

const BUYER_REFS = [
  { id: "b_apex", name: "Apex Insurance Group" },
  { id: "b_solar_united", name: "Solar United" },
  { id: "b_pinnacle_legal", name: "Pinnacle Legal Partners" },
  { id: "b_meridian_auto", name: "Meridian Auto Insurance" },
  { id: "b_hearthside", name: "Hearthside Roofing Network" },
  { id: "b_clearpath_debt", name: "Clearpath Debt Solutions" },
  { id: "b_lighthouse_aca", name: "Lighthouse ACA Verification" },
];

const PUBLISHER_REFS = [
  { id: "p_redline", name: "Redline Media Group" },
  { id: "p_blueprint", name: "Blueprint Lead Network" },
  { id: "p_apex_dial", name: "Apex Dialer Partners" },
  { id: "p_summit_traffic", name: "Summit Traffic Inc." },
  { id: "p_northstar", name: "Northstar Digital" },
];

/**
 * Per-bucket hourly distribution.
 *
 * Per client spec: fixed per-hour call deltas that build to a specific
 * cumulative curve reaching ~6,500 calls by 5pm EST. Not a bell curve —
 * the client wrote out the exact totals per hour:
 *
 *   8–9am    300  · 9–10am   700  · 10–11am   900  (cumulative)
 *   11–12pm 1900  · 12–1pm  2400  · 1–2pm    3000
 *   2–3pm   4500  · 3–4pm   5500  · 4–5pm    6500
 *
 * That gives hourly deltas of 300, 400, 200, 1000, 500, 600, 1500,
 * 1000, 1000 — a distinctive shape with the biggest single-hour burst
 * at 2–3pm EST. Each weight below is `delta / 6500` so the shape
 * scales cleanly if the daily total drifts slightly across buckets.
 *
 * A small ±3% jitter is layered per bucket so successive days aren't
 * stamped-identical, but the overall curve shape stays intact.
 */
function bucketHourWeights(): number[] {
  const BASE: Record<number, number> = {
    8:  300 / 6500,   // 0.0462
    9:  400 / 6500,   // 0.0615
    10: 200 / 6500,   // 0.0308
    11: 1000 / 6500,  // 0.1538
    12: 500 / 6500,   // 0.0769
    13: 600 / 6500,   // 0.0923
    14: 1500 / 6500,  // 0.2308  ← client's peak hour
    15: 1000 / 6500,  // 0.1538
    16: 1000 / 6500,  // 0.1538
  };
  const weights = new Array(24).fill(0);
  let sum = 0;
  for (let h = 8; h <= 16; h++) {
    // ±3% per-bucket jitter — each hour gets its own salt so the whole
    // curve wobbles slightly instead of shifting in lockstep.
    const jitter = 1 + (bucketRange(40 + h, -0.03, 0.03));
    const w = BASE[h] * jitter;
    weights[h] = w;
    sum += w;
  }
  return sum > 0 ? weights.map((w) => w / sum) : weights;
}

function pickHour(rng: () => number, weights: number[]): number {
  let r = rng();
  for (let h = 0; h < 24; h++) {
    r -= weights[h];
    if (r <= 0) return h;
  }
  // Fallback — return the bucket's peak hour rather than a hardcoded 15.
  for (let h = 0; h < 24; h++) if (weights[h] > 0) return h;
  return 13;
}

function pickCampaign(rng: () => number) {
  let r = rng() * TOTAL_CAMPAIGN_WEIGHT;
  for (const c of CAMPAIGN_REFS) {
    r -= c.weight;
    if (r <= 0) return c;
  }
  return CAMPAIGN_REFS[0];
}

function makePhone(rng: () => number): string {
  const ac = pick(AREA_CODES, rng);
  const tail = String(intRange(rng, 1_000_000, 9_999_999)).padStart(7, "0");
  return `+1${ac}${tail}`;
}

/**
 * Public, CORS-open sample MP3s used as stand-ins for call recordings
 * in demo mode. SoundHelix hosts these under a permissive license and
 * they're a widely-used choice for HTML5 audio demos, so they stream
 * reliably in the browser without any auth or preflight surprises.
 */
const DEMO_RECORDING_URLS = [
  "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3",
  "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-2.mp3",
  "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-5.mp3",
  "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-8.mp3",
];
function pickDemoRecordingUrl(idSuffix: string): string {
  let h = 0;
  for (let i = 0; i < idSuffix.length; i++) {
    h = ((h << 5) - h + idSuffix.charCodeAt(i)) | 0;
  }
  return DEMO_RECORDING_URLS[Math.abs(h) % DEMO_RECORDING_URLS.length];
}

/** Snap to midnight of today in the user's currently-selected demo
 *  timezone, expressed as UTC ms. Used to anchor both corpus generation
 *  and the today-so-far filter, so the demo respects whatever timezone
 *  the user picked in the dropdown (Live Monitor / Reports toolbar).
 *  Falls back to EST if no selection has been made. */
function startOfToday(): number {
  return startOfDayInTimeZone(getDemoTimezone());
}

export interface DemoCallWire {
  id: string;
  caller_number: string;
  destination_number: string;
  status: string;
  duration: number;
  caller_area_code: string;
  caller_state: string;
  caller_country: string;
  campaign_id: string;
  campaign_name: string;
  buyer_id: string;
  buyer_name: string;
  publisher_id: string;
  publisher_name: string;
  revenue: string;
  buyer_payout: string;
  publisher_payout: string;
  recording_url: string;
  created_at: string;
  tags: string[];
  notes: string;
}

/** ─── Cached corpus ──────────────────────────────────────────────────────
 *  Generated once per session, kept in module memory. Not persisted to
 *  localStorage (would blow the 5–10 MB quota at this volume). */

interface CorpusOptions {
  todayCount: number;
  pastDays: number;
  pastDailyAvg: number;
  /** Convert rate — fraction of calls that complete + actually pay out. */
  convertRate: number;
}

/**
 * Per-bucket options. Per client spec (4th pass):
 *   - todayCount lands close to 6,500 (the client's end-of-day cumulative
 *     target). Tight ±3% band per bucket so the daily headline reads
 *     around 6.5K while still varying enough to feel "alive".
 *   - pastDailyAvg roughly matches so the 14-day chart doesn't look off.
 *   - convertRate ~80% so ~5,200 of 6,500 connect and ~1,300 miss —
 *     matching the client's earlier "5.2K converted rest missed" line.
 */
function optsForCurrentBucket(): CorpusOptions {
  return {
    todayCount: bucketInt(7, 6_300, 6_700),
    pastDays: 13,
    pastDailyAvg: bucketInt(13, 4_500, 6_000),
    convertRate: bucketRange(11, 0.76, 0.84),
  };
}

let CACHE: DemoCallWire[] | null = null;
/** Cache key = `${bucket}|${YYYY-MM-DD}`. Combining both means cache
 *  invalidates on either bucket rollover (every 2h) OR calendar-day
 *  rollover — the day check is a safety net for edge cases where the
 *  browser preserved module state across midnight in a way that let
 *  a stale corpus slip through the bucket-only check. */
let CACHE_KEY: string | null = null;

function currentCacheKey(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  // Include the selected timezone so the corpus rebuilds when the user
  // switches timezones — otherwise the cached calls would still be
  // anchored to the old timezone's midnight and the chart would show
  // bars at the wrong hours.
  return `${currentBucket()}|${y}-${m}-${day}|${getDemoTimezone()}`;
}

export function getDemoCalls(): DemoCallWire[] {
  const key = currentCacheKey();
  if (CACHE && CACHE_KEY === key) return CACHE;
  CACHE = buildCorpus(optsForCurrentBucket());
  CACHE_KEY = key;
  return CACHE;
}

function buildCorpus(opts: CorpusOptions): DemoCallWire[] {
  // Seed is tied to the current bucket — same bucket gets the same call
  // contents (campaign winners, buyer mix, caller numbers), the next
  // bucket reshuffles.
  const rng = makeRng(202_606_26 + currentBucket() * 31);
  const start = startOfToday();
  const out: DemoCallWire[] = [];

  // Build today's hour distribution once per bucket; reuse it for past
  // days so the day-shape stays coherent across the 14-day view.
  const weights = bucketHourWeights();

  // ─── Today ───────────────────────────────────────────────────────────
  // We intentionally allow timestamps anywhere in today's 24h window —
  // including hours that haven't happened yet in wall-clock time. This is a
  // marketing demo: the dashboard should always look like a full active
  // business day, regardless of when the demo is opened.
  for (let i = 0; i < opts.todayCount; i++) {
    const hour = pickHour(rng, weights);
    const minute = intRange(rng, 0, 59);
    const second = intRange(rng, 0, 59);
    const ts = start + hour * HOUR + minute * 60_000 + second * 1000;
    out.push(makeCall(`today_${i.toString(36)}`, ts, rng, opts.convertRate));
  }

  // ─── Past N days ─────────────────────────────────────────────────────
  for (let dayOffset = 1; dayOffset <= opts.pastDays; dayOffset++) {
    // Slight day-to-day variation so the 14-day chart has shape.
    const dayCount = Math.round(opts.pastDailyAvg * range(rng, 0.7, 1.3));
    const dayStart = start - dayOffset * DAY;
    for (let i = 0; i < dayCount; i++) {
      const hour = pickHour(rng, weights);
      const minute = intRange(rng, 0, 59);
      const second = intRange(rng, 0, 59);
      const ts = dayStart + hour * HOUR + minute * 60_000 + second * 1000;
      out.push(makeCall(`d${dayOffset}_${i.toString(36)}`, ts, rng, opts.convertRate));
    }
  }

  // Sort newest → oldest.
  out.sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
  return out;
}

const LIVE_FAILURE_STATUSES = ["missed", "rejected", "failed"];

function makeCall(
  idSuffix: string,
  startedAt: number,
  rng: () => number,
  convertRate: number,
): DemoCallWire {
  const camp = pickCampaign(rng);
  const buyer = pick(BUYER_REFS, rng);
  const publisher = pick(PUBLISHER_REFS, rng);
  const isConverted = chance(rng, convertRate);
  const status: string = isConverted ? "completed" : pick(LIVE_FAILURE_STATUSES, rng);
  // Per client spec: average handle time must be 15+ minutes. Range
  // 15–25 min for completed calls gives a ~20 min average comfortably
  // above the floor. Missed / rejected stay short because they didn't
  // connect to an agent.
  const duration = isConverted
    ? intRange(rng, 900, 1_500)
    : status === "missed"
      ? intRange(rng, 5, 35)
      : intRange(rng, 1, 12);
  const revenue = isConverted ? camp.payout : 0;
  const publisherPayout = isConverted ? Math.round(camp.payout * 0.58) : 0;
  const areaCode = pick(AREA_CODES, rng);
  return {
    id: `call_${idSuffix}`,
    caller_number: makePhone(rng),
    destination_number: `+1800${String(intRange(rng, 5_550_000, 5_559_999))}`,
    status,
    duration,
    caller_area_code: areaCode,
    caller_state: pick(STATES, rng),
    caller_country: "US",
    campaign_id: camp.id,
    campaign_name: camp.name,
    buyer_id: buyer.id,
    buyer_name: buyer.name,
    publisher_id: publisher.id,
    publisher_name: publisher.name,
    revenue: revenue.toFixed(2),
    buyer_payout: revenue.toFixed(2),
    publisher_payout: publisherPayout.toFixed(2),
    // Point recordings at real, publicly-hosted MP3 samples so the
    // player in the Call Log actually plays audio when the Play button
    // is clicked. Round-robin across a small pool so different rows get
    // audibly-different clips. Missed / rejected calls stay URL-less
    // because they never connected — nothing was recorded.
    recording_url: isConverted ? pickDemoRecordingUrl(idSuffix) : "",
    created_at: new Date(startedAt).toISOString(),
    tags: isConverted ? ["converted"] : [],
    notes: "",
  };
}

/* ─── Cumulative filter helpers ──────────────────────────────────────────
 *   TOTAL grows through the day per the client's cumulative spec:
 *     8am→300, 9am→700, 10am→900, 11am→1900, 12pm→2400, 1pm→3000,
 *     2pm→4500, 3pm→5500, 4pm→6500.
 *   These helpers filter out today's future-timestamped calls so the
 *   topbar TOTAL, donut, dialer tiles, and hourly chart all reflect
 *   "cumulative up to now", not the projected end-of-day total. */

/** All corpus calls that have happened as of now — past days pass through
 *  unchanged; today's future-timestamped calls are held back. */
export function visibleCalls(): DemoCallWire[] {
  const now = Date.now();
  return getDemoCalls().filter((c) => {
    const ts = Date.parse(c.created_at);
    return Number.isFinite(ts) && ts <= now;
  });
}

/** Today-so-far — calls between startOfToday and now. At 12:28 PM this
 *  returns roughly 2,100 calls (per client's 12pm→2,400 cumulative
 *  target), not the projected end-of-day 6,500. */
export function todaysCalls(): DemoCallWire[] {
  const start = startOfToday();
  const now = Date.now();
  return getDemoCalls().filter((c) => {
    const ts = Date.parse(c.created_at);
    return Number.isFinite(ts) && ts >= start && ts <= now;
  });
}

/* ─── Live (in-flight) call snapshot ──────────────────────────────────── */

/** Return the current hour (0–23) in the user's selected demo timezone.
 *  Used to swing `liveCallsCount()` between peak, business, and
 *  off-hours bands so the LIVE tile tracks the "operational day" as the
 *  user is viewing it, not their PC's timezone. */
function currentESTHour(): number {
  try {
    const s = new Date().toLocaleString("en-US", {
      hour: "numeric",
      hour12: false,
      timeZone: getDemoTimezone(),
    });
    const h = parseInt(s, 10);
    if (!Number.isFinite(h)) return 12;
    return h === 24 ? 0 : h;
  } catch {
    return 12;
  }
}

/** Number of in-flight calls "right now" — per-hour targets from the
 *  client's operational spec. Each hour has its own concurrent-call
 *  band; the roster in agents.ts is sized above the peak (260 max) so
 *  "Agents free" is never zero.
 *
 *    8am    50   ·  9am    90   ·  10am   150
 *    11am   230–260  ·  12pm   230–260  ·  1pm   190–210
 *    2pm    ~210   ·  3pm    ~230   ·  4pm    ~130
 *    other  10–40 (off-shift trickle)
 *
 *  Small ±5% jitter is layered inside each band so successive polls
 *  within an hour don't return identical numbers. */
export function liveCallsCount(): number {
  const hour = currentESTHour();
  const HOURLY_LIVE: Record<number, [number, number]> = {
    8: [42, 58],
    9: [80, 100],
    10: [140, 160],
    11: [230, 260],
    12: [230, 260],
    13: [190, 210],
    14: [200, 220],
    15: [220, 240],
    16: [120, 140],
  };
  const band = HOURLY_LIVE[hour];
  if (band) return bucketInt(3, band[0], band[1]);
  // Outside 8am–4:59pm EST → off-shift trickle
  return bucketInt(3, 10, 40);
}

export function generateLiveCalls(count = liveCallsCount()): DemoCallWire[] {
  const rng = makeRng(7_777);
  const rows: DemoCallWire[] = [];
  const liveStatuses = ["ringing", "in-progress", "in-progress", "in-progress"];
  for (let i = 0; i < count; i++) {
    const camp = pickCampaign(rng);
    const buyer = pick(BUYER_REFS, rng);
    const publisher = pick(PUBLISHER_REFS, rng);
    const startedAt = Date.now() - intRange(rng, 5, 240) * 1000;
    rows.push({
      id: `live_${i.toString(36)}`,
      caller_number: makePhone(rng),
      destination_number: `+1800${String(intRange(rng, 5_550_000, 5_559_999))}`,
      status: pick(liveStatuses, rng),
      duration: Math.floor((Date.now() - startedAt) / 1000),
      caller_area_code: pick(AREA_CODES, rng),
      caller_state: pick(STATES, rng),
      caller_country: "US",
      campaign_id: camp.id,
      campaign_name: camp.name,
      buyer_id: buyer.id,
      buyer_name: buyer.name,
      publisher_id: publisher.id,
      publisher_name: publisher.name,
      revenue: "0.00",
      buyer_payout: "0.00",
      publisher_payout: "0.00",
      recording_url: "",
      created_at: new Date(startedAt).toISOString(),
      tags: [],
      notes: "",
    });
  }
  return rows;
}

/* ─── Dashboard KPI snapshot ──────────────────────────────────────────── */
/* Returns the wire shape `/api/analytics/dashboard` is supposed to return —
 * derived live from the today corpus so the donut, charts, and KPI tiles
 * all tell the same story. */

export function dashboardSnapshot() {
  const today = todaysCalls();
  const totalToday = today.length;
  const completed = today.filter((c) => c.status === "completed").length;
  const dropped = totalToday - completed;
  const liveCount = liveCallsCount();
  // Per client spec: sales = 10% of connected (completed) calls. This is
  // distinct from "completed" / "converted" — a connected call is one
  // that picked up; a sale is a connected call that actually closed.
  const totalSales = Math.round(completed * 0.10);
  const totalRevenue = today.reduce((s, c) => s + Number(c.revenue || 0), 0);
  const totalPayout = today.reduce((s, c) => s + Number(c.publisher_payout || 0), 0);
  const totalProfit = totalRevenue - totalPayout;
  const totalDuration = today.reduce((s, c) => s + (c.duration || 0), 0);
  const avgDuration = totalToday > 0 ? Math.round(totalDuration / totalToday) : 0;
  const spamBlocked = 412;
  const duplicateBlocked = 86;
  return {
    total_calls: getDemoCalls().length,
    calls_today: totalToday,
    live_calls: liveCount,
    completed_calls: completed,
    converted_calls: completed,
    conversion_rate: totalToday > 0 ? completed / totalToday : 0,
    total_revenue: totalRevenue.toFixed(2),
    total_payout: totalPayout.toFixed(2),
    total_profit: totalProfit.toFixed(2),
    avg_call_duration: avgDuration,
    spam_blocked: spamBlocked,
    duplicate_blocked: duplicateBlocked,
    // Bonus aggregates the donut/other widgets read directly.
    total_missed: today.filter((c) => c.status === "missed").length,
    total_rejected: today.filter((c) => c.status === "rejected").length,
    not_connected: dropped,
    total_sales: totalSales,
  };
}
