/**
 * Demo data for client results — deterministic (same client, channel and
 * month → same numbers), internally consistent (clicks ≤ impressions,
 * conversions ≤ clicks), gently trending up. Used by the demo seed and, in
 * development only (ANALYTICS_MOCK=true), by "Sync". Every value it writes is
 * stored with source MOCK and labelled "Demo data" wherever it shows.
 */
import { CHANNEL, metricKey, type Channel } from "@/modules/client-analytics/metrics";
import type { MonthValues } from "@/modules/integrations/analytics/provider";

function hash(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  h ^= h >>> 13;
  h = Math.imul(h, 0x5bd1e995);
  return (h ^ (h >>> 15)) >>> 0;
}

/** A 0–1 number from a seed. */
const unit = (seed: string) => (hash(seed) % 10_000) / 10_000;

/** Months since 2026-01, for a gentle upward trend. */
const monthIndex = (month: string) => (Number(month.slice(0, 4)) - 2026) * 12 + Number(month.slice(5, 7)) - 1;

export function mockMonth(clientId: string, channel: Channel, month: string): MonthValues {
  const r = (k: string) => unit(`${clientId}|${channel}|${k}|${month}`);
  const scale = 0.7 + unit(`${clientId}|${channel}|scale`) * 0.8; // this client's size
  const trend = 1 + monthIndex(month) * 0.035; // ~3.5% a month
  const n = (base: number, k: string, spread = 0.12) => Math.max(0, Math.round(base * scale * trend * (1 - spread + r(k) * spread * 2)));
  const v: Record<string, number> = {};
  switch (channel) {
    case "googleAds": {
      v.impressions = n(42_000, "imp");
      v.clicks = Math.min(v.impressions, n(1_900, "clk"));
      v.cost = n(1_450_00, "cost", 0.05);
      v.conversions = Math.min(v.clicks, n(120, "conv"));
      v.conversionValue = n(6_900_00, "val");
      break;
    }
    case "metaAds": {
      v.reach = n(38_000, "reach");
      v.impressions = Math.max(v.reach, n(96_000, "imp"));
      v.clicks = Math.min(v.impressions, n(2_300, "clk"));
      v.cost = n(980_00, "cost", 0.05);
      v.conversions = Math.min(v.clicks, n(85, "conv"));
      v.conversionValue = n(3_900_00, "val");
      break;
    }
    case "leads": {
      v.leads = n(140, "leads");
      v.calls = n(95, "calls");
      v.bookings = Math.min(v.leads, n(88, "book"));
      v.orders = n(210, "orders");
      break;
    }
    case "website": {
      v.sessions = n(6_800, "sess");
      v.users = Math.min(v.sessions, n(5_100, "users"));
      v.engagedSessions = Math.min(v.sessions, n(4_100, "eng"));
      v.keyEvents = Math.min(v.sessions, n(310, "ke"));
      v.avgSessionSeconds = n(96, "dur", 0.1);
      break;
    }
    case "seo": {
      v.impressions = n(58_000, "imp");
      v.clicks = Math.min(v.impressions, n(2_600, "clk"));
      // Position improves (falls) as months pass; thousandths.
      v.avgPosition = Math.max(1_500, Math.round((14_000 - monthIndex(month) * 450) * (0.9 + r("pos") * 0.2)));
      v.topTenKeywords = n(24, "kw");
      break;
    }
    case "localSeo": {
      v.profileViews = n(9_400, "views");
      v.calls = n(160, "calls");
      v.directions = n(420, "dir");
      v.websiteClicks = n(510, "web");
      v.reviews = n(14, "rev", 0.3);
      v.avgRating = Math.min(5_000, 4_300 + Math.round(r("rating") * 600));
      break;
    }
  }
  return CHANNEL[channel].base.map((b) => ({ metricKey: metricKey(channel, b.key), value: v[b.key] ?? 0 }));
}
