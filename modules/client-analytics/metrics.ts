/**
 * The client analytics metric model (Phase 8 scope 3). Pure. Each channel is
 * a set of stored base metrics (integers, scaled by unit) and derived rates
 * computed from them — a rate is never stored, so it can never disagree with
 * its parts. Formulas: docs/METRICS.md → "Client results".
 */

import { formatMoney } from "@/modules/billing/money";

export const CHANNELS = ["googleAds", "metaAds", "leads", "website", "seo", "localSeo"] as const;
export type Channel = (typeof CHANNELS)[number];

/** count: as-is · money: minor units · decimal: thousandths (7.3 → 7300) · seconds. */
export type Unit = "count" | "money" | "decimal" | "seconds";

export type BaseMetric = { key: string; label: string; unit: Unit; better: "up" | "down"; headline?: boolean };
export type DerivedMetric = { key: string; label: string; kind: "percent" | "money" | "ratio" | "decimal"; better: "up" | "down"; compute: (v: Record<string, number | undefined>) => number | null };

export const PROVIDERS = ["GOOGLE_ADS", "META_ADS", "GA4", "SEARCH_CONSOLE", "GOOGLE_BUSINESS_PROFILE"] as const;
export type ProviderId = (typeof PROVIDERS)[number];
export const PROVIDER_LABEL: Record<ProviderId, string> = {
  GOOGLE_ADS: "Google Ads",
  META_ADS: "Meta Ads",
  GA4: "Google Analytics 4",
  SEARCH_CONSOLE: "Search Console",
  GOOGLE_BUSINESS_PROFILE: "Google Business Profile",
};

export const SOURCES = ["MANUAL", ...PROVIDERS, "MOCK"] as const;
export type Source = (typeof SOURCES)[number];
/** When one month has values from several sources, this one wins: a person's correction, then a live sync, then demo data. */
export const SOURCE_PRECEDENCE: readonly Source[] = ["MANUAL", "GOOGLE_ADS", "META_ADS", "GA4", "SEARCH_CONSOLE", "GOOGLE_BUSINESS_PROFILE", "MOCK"];

const div = (a: number | undefined, b: number | undefined) => (a === undefined || b === undefined || b === 0 ? null : a / b);
const pct = (a: number | undefined, b: number | undefined) => {
  const r = div(a, b);
  return r === null ? null : Math.round(r * 1000) / 10; // one decimal of a percent
};
const perUnit = (money: number | undefined, count: number | undefined) => {
  const r = div(money, count);
  return r === null ? null : Math.round(r);
};
const ratio = (a: number | undefined, b: number | undefined) => {
  const r = div(a, b);
  return r === null ? null : Math.round(r * 100) / 100;
};

export type ChannelDef = { label: string; question: string; provider: ProviderId | null; base: BaseMetric[]; derived: DerivedMetric[] };

export const CHANNEL: Record<Channel, ChannelDef> = {
  googleAds: {
    label: "Google Ads",
    question: "Is paid search bringing in customers at a good price?",
    provider: "GOOGLE_ADS",
    base: [
      { key: "impressions", label: "Impressions", unit: "count", better: "up" },
      { key: "clicks", label: "Clicks", unit: "count", better: "up" },
      { key: "cost", label: "Spend", unit: "money", better: "down" },
      { key: "conversions", label: "Conversions", unit: "count", better: "up", headline: true },
      { key: "conversionValue", label: "Conversion value", unit: "money", better: "up" },
    ],
    derived: [
      { key: "ctr", label: "Click-through rate", kind: "percent", better: "up", compute: (v) => pct(v.clicks, v.impressions) },
      { key: "cpc", label: "Cost per click", kind: "money", better: "down", compute: (v) => perUnit(v.cost, v.clicks) },
      { key: "cpa", label: "Cost per conversion", kind: "money", better: "down", compute: (v) => perUnit(v.cost, v.conversions) },
      { key: "roas", label: "Return on ad spend", kind: "ratio", better: "up", compute: (v) => ratio(v.conversionValue, v.cost) },
    ],
  },
  metaAds: {
    label: "Meta (Facebook & Instagram)",
    question: "Are social campaigns reaching people and turning them into guests?",
    provider: "META_ADS",
    base: [
      { key: "reach", label: "Reach", unit: "count", better: "up" },
      { key: "impressions", label: "Impressions", unit: "count", better: "up" },
      { key: "clicks", label: "Link clicks", unit: "count", better: "up" },
      { key: "cost", label: "Spend", unit: "money", better: "down" },
      { key: "conversions", label: "Results", unit: "count", better: "up", headline: true },
      { key: "conversionValue", label: "Result value", unit: "money", better: "up" },
    ],
    derived: [
      { key: "ctr", label: "Click-through rate", kind: "percent", better: "up", compute: (v) => pct(v.clicks, v.impressions) },
      { key: "cpa", label: "Cost per result", kind: "money", better: "down", compute: (v) => perUnit(v.cost, v.conversions) },
      { key: "roas", label: "Return on ad spend", kind: "ratio", better: "up", compute: (v) => ratio(v.conversionValue, v.cost) },
    ],
  },
  leads: {
    label: "Leads & bookings",
    question: "How many people got in touch, and how many booked?",
    provider: null,
    base: [
      { key: "leads", label: "Leads", unit: "count", better: "up", headline: true },
      { key: "calls", label: "Phone calls", unit: "count", better: "up" },
      { key: "bookings", label: "Bookings", unit: "count", better: "up" },
      { key: "orders", label: "Online orders", unit: "count", better: "up" },
    ],
    derived: [{ key: "bookingRate", label: "Booking rate", kind: "percent", better: "up", compute: (v) => pct(v.bookings, v.leads) }],
  },
  website: {
    label: "Website traffic",
    question: "Are more people visiting the site, and doing something there?",
    provider: "GA4",
    base: [
      { key: "sessions", label: "Sessions", unit: "count", better: "up", headline: true },
      { key: "users", label: "Visitors", unit: "count", better: "up" },
      { key: "engagedSessions", label: "Engaged sessions", unit: "count", better: "up" },
      { key: "keyEvents", label: "Key events (bookings, orders, calls)", unit: "count", better: "up" },
      { key: "avgSessionSeconds", label: "Average visit", unit: "seconds", better: "up" },
    ],
    derived: [
      { key: "engagementRate", label: "Engagement rate", kind: "percent", better: "up", compute: (v) => pct(v.engagedSessions, v.sessions) },
      { key: "conversionRate", label: "Conversion rate", kind: "percent", better: "up", compute: (v) => pct(v.keyEvents, v.sessions) },
    ],
  },
  seo: {
    label: "SEO",
    question: "Is the restaurant showing up — and getting clicked — in search?",
    provider: "SEARCH_CONSOLE",
    base: [
      { key: "impressions", label: "Search impressions", unit: "count", better: "up" },
      { key: "clicks", label: "Search clicks", unit: "count", better: "up", headline: true },
      { key: "avgPosition", label: "Average position", unit: "decimal", better: "down" },
      { key: "topTenKeywords", label: "Keywords in the top 10", unit: "count", better: "up" },
    ],
    derived: [{ key: "ctr", label: "Click-through rate", kind: "percent", better: "up", compute: (v) => pct(v.clicks, v.impressions) }],
  },
  localSeo: {
    label: "Local SEO (Google Business Profile)",
    question: "Are locals finding the listing and acting on it?",
    provider: "GOOGLE_BUSINESS_PROFILE",
    base: [
      { key: "profileViews", label: "Profile views", unit: "count", better: "up" },
      { key: "calls", label: "Calls", unit: "count", better: "up" },
      { key: "directions", label: "Direction requests", unit: "count", better: "up", headline: true },
      { key: "websiteClicks", label: "Website clicks", unit: "count", better: "up" },
      { key: "reviews", label: "New reviews", unit: "count", better: "up" },
      { key: "avgRating", label: "Average rating", unit: "decimal", better: "up" },
    ],
    derived: [{ key: "actionRate", label: "Action rate", kind: "percent", better: "up", compute: (v) => pct((v.calls ?? 0) + (v.directions ?? 0) + (v.websiteClicks ?? 0), v.profileViews) }],
  },
};

/** Which channels a client's services bring (the rest appear only if they have data). */
export const SERVICE_CHANNELS: Record<string, Channel[]> = {
  "google-ads": ["googleAds", "leads"],
  "meta-ads": ["metaAds", "leads"],
  "social-media-marketing": ["metaAds"],
  "website-development": ["website"],
  seo: ["seo", "website"],
  "local-seo": ["localSeo"],
  "google-business-profile": ["localSeo"],
};

export function channelsForServices(slugs: readonly string[]): Channel[] {
  const set = new Set<Channel>();
  for (const s of slugs) for (const c of SERVICE_CHANNELS[s] ?? []) set.add(c);
  return CHANNELS.filter((c) => set.has(c));
}

export const metricKey = (channel: Channel, key: string) => `${channel}.${key}`;

export function baseMetric(fullKey: string): { channel: Channel; metric: BaseMetric } | null {
  const [channel, key] = fullKey.split(".");
  if (!(CHANNELS as readonly string[]).includes(channel)) return null;
  const metric = CHANNEL[channel as Channel].base.find((m) => m.key === key);
  return metric ? { channel: channel as Channel, metric } : null;
}

/** Typed text → the stored integer for a unit ("1,250.50" money → 125050; "7.3" decimal → 7300; "2:15" or "135" seconds → 135). */
export function parseMetric(unit: Unit, input: string): { ok: true; value: number } | { ok: false; error: string } {
  const text = input.trim().replace(/,/g, "");
  if (unit === "seconds") {
    const mmss = /^(\d{1,3}):([0-5]\d)$/.exec(text);
    if (mmss) return { ok: true, value: Number(mmss[1]) * 60 + Number(mmss[2]) };
  }
  const m = /^(\d{1,12})(?:\.(\d{1,3}))?$/.exec(text);
  if (!m) return { ok: false, error: "Enter a number" };
  const whole = Number(m[1]);
  const frac = m[2] ?? "";
  if (unit === "count" || unit === "seconds") return frac ? { ok: false, error: "Whole numbers only" } : { ok: true, value: whole };
  if (unit === "money") return frac.length > 2 ? { ok: false, error: "At most two decimals" } : { ok: true, value: whole * 100 + Number(frac.padEnd(2, "0")) };
  return { ok: true, value: whole * 1000 + Number(frac.padEnd(3, "0")) };
}

/** A stored value for display. */
export function formatMetric(unit: Unit, value: number, currency = "USD"): string {
  if (unit === "money") return formatMoney(value, currency, { whole: value >= 100_000 });
  if (unit === "decimal") return (value / 1000).toLocaleString("en-US", { maximumFractionDigits: 1 });
  if (unit === "seconds") return `${Math.floor(value / 60)}:${String(value % 60).padStart(2, "0")}`;
  return value.toLocaleString("en-US");
}

export function formatDerived(kind: DerivedMetric["kind"], value: number | null, currency = "USD"): string {
  if (value === null) return "—";
  if (kind === "percent") return `${value.toLocaleString("en-US", { maximumFractionDigits: 1 })}%`;
  if (kind === "money") return formatMoney(value, currency);
  if (kind === "ratio") return `${value.toFixed(2)}×`;
  return value.toLocaleString("en-US");
}

/** The editable text of a stored value (the inverse of parseMetric). */
export function metricText(unit: Unit, value: number): string {
  if (unit === "money") return `${Math.floor(value / 100)}.${String(value % 100).padStart(2, "0")}`;
  if (unit === "decimal") return String(value / 1000);
  return String(value);
}

export type ValueRow = { metricKey: string; source: string; periodStart: string; value: number };

/** One value per metric per month: the highest-precedence source wins. */
export function resolveValues(rows: readonly ValueRow[]): Map<string, { value: number; source: string }> {
  const out = new Map<string, { value: number; source: string }>();
  const rank = (s: string) => {
    const i = SOURCE_PRECEDENCE.indexOf(s as Source);
    return i === -1 ? SOURCE_PRECEDENCE.length : i;
  };
  for (const r of rows) {
    const key = `${r.periodStart.slice(0, 7)}|${r.metricKey}`;
    const current = out.get(key);
    if (!current || rank(r.source) < rank(current.source)) out.set(key, { value: r.value, source: r.source });
  }
  return out;
}

export type MetricView = { key: string; label: string; unit: Unit | DerivedMetric["kind"]; derived: boolean; value: number | null; previous: number | null; display: string; change: number | null; good: boolean | null; source: string | null };

/**
 * A channel for one month, against the month before: base metrics (as
 * stored) then derived rates. `good` says whether the change is an
 * improvement given the metric's direction (lower spend is good) — the UI
 * colours good changes green and the rest gray.
 */
export function channelMonth(channel: Channel, month: string, prevMonth: string, values: Map<string, { value: number; source: string }>, currency = "USD"): { channel: Channel; label: string; question: string; hasData: boolean; metrics: MetricView[] } {
  const def = CHANNEL[channel];
  const get = (m: string, key: string) => values.get(`${m}|${metricKey(channel, key)}`);
  const cur: Record<string, number | undefined> = {};
  const prev: Record<string, number | undefined> = {};
  for (const b of def.base) {
    cur[b.key] = get(month, b.key)?.value;
    prev[b.key] = get(prevMonth, b.key)?.value;
  }
  const judge = (better: "up" | "down", now: number | null, before: number | null) => (now === null || before === null || now === before ? null : better === "up" ? now > before : now < before);
  const base: MetricView[] = def.base.map((b) => {
    const now = cur[b.key] ?? null;
    const before = prev[b.key] ?? null;
    return { key: b.key, label: b.label, unit: b.unit, derived: false, value: now, previous: before, display: now === null ? "—" : formatMetric(b.unit, now, currency), change: now !== null && before !== null ? now - before : null, good: judge(b.better, now, before), source: get(month, b.key)?.source ?? null };
  });
  const derived: MetricView[] = def.derived.map((d) => {
    const now = d.compute(cur);
    const before = d.compute(prev);
    return { key: d.key, label: d.label, unit: d.kind, derived: true, value: now, previous: before, display: formatDerived(d.kind, now, currency), change: now !== null && before !== null ? Math.round((now - before) * 100) / 100 : null, good: judge(d.better, now, before), source: null };
  });
  return { channel, label: def.label, question: def.question, hasData: base.some((m) => m.value !== null), metrics: [...base, ...derived] };
}

/** "YYYY-MM" → the month before. */
export function previousMonth(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
}

/**
 * The same figures in a restaurant owner's words (Phase 10) — for what the
 * client reads: the monthly report and its PDF. The team's Results tab keeps
 * the marketing terms it works in. Anything unlisted is already plain.
 */
export const CLIENT_CHANNEL_LABEL: Partial<Record<Channel, string>> = {
  leads: "Enquiries & bookings",
  seo: "Google search",
  localSeo: "Your Google listing",
};

export const CLIENT_METRIC_LABEL: Record<string, string> = {
  "googleAds.impressions": "Times your ads were shown",
  "googleAds.clicks": "Ad clicks",
  "googleAds.cost": "Ad spend",
  "googleAds.conversions": "Customer actions",
  "googleAds.conversionValue": "Value of those actions",
  "googleAds.ctr": "% of viewers who clicked",
  "googleAds.cpa": "Cost per customer action",
  "googleAds.roas": "Revenue per $1 of ads",
  "metaAds.reach": "People reached",
  "metaAds.impressions": "Times your ads were shown",
  "metaAds.cost": "Ad spend",
  "metaAds.conversionValue": "Value of results",
  "metaAds.ctr": "% of viewers who clicked",
  "metaAds.roas": "Revenue per $1 of ads",
  "leads.leads": "Enquiries",
  "leads.bookingRate": "Enquiries that booked",
  "website.sessions": "Website visits",
  "website.engagedSessions": "Engaged visits",
  "website.keyEvents": "Actions taken (bookings, orders, calls)",
  "website.engagementRate": "Visits that engaged",
  "website.conversionRate": "Visits that led to an action",
  "seo.impressions": "Times shown in Google search",
  "seo.clicks": "Clicks from Google search",
  "seo.avgPosition": "Average ranking",
  "seo.topTenKeywords": "Searches where you're on page one",
  "seo.ctr": "% of searchers who clicked",
  "localSeo.profileViews": "Listing views",
  "localSeo.actionRate": "Views that led to a call, visit or click",
};

export const clientMetricLabel = (channel: Channel, key: string, label: string) => CLIENT_METRIC_LABEL[`${channel}.${key}`] ?? label;
