/**
 * The Command Center's arithmetic (Phase 8 scope 1). Pure: periods arrive as
 * company-calendar day keys ("YYYY-MM-DD"), rows as plain values, so every
 * figure is testable and the formulas in docs/METRICS.md are the code.
 */

export const PERIODS = ["7d", "30d", "90d", "month", "quarter", "year"] as const;
export type Period = (typeof PERIODS)[number];
export const PERIOD_LABEL: Record<Period, string> = {
  "7d": "Last 7 days",
  "30d": "Last 30 days",
  "90d": "Last 90 days",
  month: "This month",
  quarter: "This quarter",
  year: "This year",
};

export type Granularity = "day" | "week" | "month";

const toDate = (key: string) => new Date(`${key}T00:00:00Z`);
const toKey = (d: Date) => d.toISOString().slice(0, 10);
export const addDays = (key: string, n: number) => {
  const d = toDate(key);
  d.setUTCDate(d.getUTCDate() + n);
  return toKey(d);
};
export const daysBetween = (from: string, to: string) => Math.round((toDate(to).getTime() - toDate(from).getTime()) / 86_400_000) + 1;

export type Bounds = { from: string; to: string; prevFrom: string; prevTo: string; days: number; granularity: Granularity };

/**
 * A period, and the comparison period: the same number of days immediately
 * before it (so "this month" on the 10th compares with the ten days before
 * the 1st — like for like, never a full month against a partial one).
 */
export function periodBounds(period: Period, todayKey: string): Bounds {
  const y = Number(todayKey.slice(0, 4));
  const m = Number(todayKey.slice(5, 7));
  const pad = (n: number) => String(n).padStart(2, "0");
  let from: string;
  if (period === "7d") from = addDays(todayKey, -6);
  else if (period === "30d") from = addDays(todayKey, -29);
  else if (period === "90d") from = addDays(todayKey, -89);
  else if (period === "month") from = `${y}-${pad(m)}-01`;
  else if (period === "quarter") from = `${y}-${pad(Math.floor((m - 1) / 3) * 3 + 1)}-01`;
  else from = `${y}-01-01`;
  const days = daysBetween(from, todayKey);
  const prevTo = addDays(from, -1);
  const prevFrom = addDays(prevTo, -(days - 1));
  const granularity: Granularity = days <= 31 ? "day" : days <= 120 ? "week" : "month";
  return { from, to: todayKey, prevFrom, prevTo, days, granularity };
}

/** The bucket a day falls in: itself, its ISO week's Monday, or its month. */
export function bucketOf(key: string, g: Granularity): string {
  if (g === "day") return key;
  if (g === "month") return key.slice(0, 7);
  const d = toDate(key);
  const dow = (d.getUTCDay() + 6) % 7; // Monday = 0
  d.setUTCDate(d.getUTCDate() - dow);
  return toKey(d);
}

/** Every bucket from `from` to `to`, in order — empty ones included, so a chart has no gaps. */
export function bucketsBetween(from: string, to: string, g: Granularity): string[] {
  const out: string[] = [];
  let k = from;
  while (k <= to) {
    const b = bucketOf(k, g);
    if (out[out.length - 1] !== b) out.push(b);
    k = addDays(k, 1);
  }
  return out;
}

export type Delta = {
  value: number;
  previous: number;
  change: number;
  /** Relative change, rounded to a whole percent; null when the previous value was 0. */
  percent: number | null;
  direction: "up" | "down" | "flat";
};

export function delta(value: number, previous: number): Delta {
  const change = value - previous;
  return {
    value,
    previous,
    change,
    percent: previous === 0 ? null : Math.round((change / Math.abs(previous)) * 100),
    direction: change > 0 ? "up" : change < 0 ? "down" : "flat",
  };
}

/** A rate in whole percent (won ÷ closed, on time ÷ due…); null when there is nothing to divide by. */
export const rate = (part: number, whole: number): number | null => (whole === 0 ? null : Math.round((part / whole) * 100));

/** Deltas of two rates, in percentage points; null rates compare as flat. */
export function rateDelta(value: number | null, previous: number | null): Delta & { available: boolean } {
  if (value === null || previous === null) return { ...delta(value ?? 0, value ?? 0), available: value !== null };
  return { ...delta(value, previous), percent: null, available: true };
}

export const inBounds = (key: string, from: string, to: string) => key >= from && key <= to;

/** Counts (or sums) rows into the buckets of a period. */
export function series<T>(rows: readonly T[], keyOf: (r: T) => string, b: Bounds, weight: (r: T) => number = () => 1): { bucket: string; value: number }[] {
  const buckets = bucketsBetween(b.from, b.to, b.granularity);
  const map = new Map(buckets.map((k) => [k, 0]));
  for (const r of rows) {
    const k = keyOf(r);
    if (!inBounds(k, b.from, b.to)) continue;
    const bucket = bucketOf(k, b.granularity);
    map.set(bucket, (map.get(bucket) ?? 0) + weight(r));
  }
  return buckets.map((bucket) => ({ bucket, value: map.get(bucket) ?? 0 }));
}

/** Top-N breakdown, largest first, with an "Other" remainder so the parts sum to the whole. */
export function breakdown(entries: readonly { key: string; label: string; value: number }[], top = 6) {
  const merged = new Map<string, { key: string; label: string; value: number }>();
  for (const e of entries) {
    const m = merged.get(e.key) ?? { ...e, value: 0 };
    m.value += e.value;
    merged.set(e.key, m);
  }
  const sorted = [...merged.values()].filter((e) => e.value !== 0).sort((a, b) => b.value - a.value);
  if (sorted.length <= top) return sorted;
  const rest = sorted.slice(top - 1).reduce((s, e) => s + e.value, 0);
  return [...sorted.slice(0, top - 1), { key: "other", label: "Other", value: rest }];
}

// ---------------------------------------------------------------------------
// Client retention (the analytics hub)
// ---------------------------------------------------------------------------

export type RetentionClient = { id: string; name: string; status: string; startKey: string; churnKey: string | null };

/**
 * Retention over [from, to]: of the clients active when the period began
 * (started before it, not churned before it), how many are still active at
 * its end. New clients and churned ones are counted too. LEAD-status
 * records are prospects, not clients, and are ignored.
 */
export function retentionOf(clients: readonly RetentionClient[], from: string, to: string) {
  const real = clients.filter((c) => c.status !== "LEAD");
  const atStart = real.filter((c) => c.startKey < from && (c.churnKey === null || c.churnKey >= from));
  const lostFromStart = atStart.filter((c) => c.churnKey !== null && c.churnKey <= to);
  const churned = real.filter((c) => c.churnKey !== null && inBounds(c.churnKey, from, to));
  const added = real.filter((c) => inBounds(c.startKey, from, to));
  const activeNow = real.filter((c) => c.churnKey === null || c.churnKey > to);
  return {
    activeAtStart: atStart.length,
    retained: atStart.length - lostFromStart.length,
    retentionRate: rate(atStart.length - lostFromStart.length, atStart.length),
    churnRate: rate(lostFromStart.length, atStart.length),
    added: added.length,
    churned: churned.map((c) => ({ id: c.id, name: c.name, churnKey: c.churnKey! })),
    activeNow: activeNow.length,
  };
}

// ---------------------------------------------------------------------------
// Receivables aging (outstanding payments)
// ---------------------------------------------------------------------------

export const AGING_BUCKETS = ["current", "1-30", "31-60", "61-90", "90+"] as const;
export type AgingBucket = (typeof AGING_BUCKETS)[number];
export const AGING_LABEL: Record<AgingBucket, string> = { current: "Not yet due", "1-30": "1–30 days late", "31-60": "31–60 days late", "61-90": "61–90 days late", "90+": "Over 90 days late" };

export function agingBucket(dueKey: string, todayKey: string): AgingBucket {
  const late = daysBetween(dueKey, todayKey) - 1;
  if (late <= 0) return "current";
  if (late <= 30) return "1-30";
  if (late <= 60) return "31-60";
  if (late <= 90) return "61-90";
  return "90+";
}

/** Open balances by how late they are, and by client (largest first); the buckets sum to the total. */
export function agingOf(invoices: readonly { clientId: string; clientName: string; dueKey: string; balanceMinor: number }[], todayKey: string) {
  const buckets = Object.fromEntries(AGING_BUCKETS.map((b) => [b, 0])) as Record<AgingBucket, number>;
  const clients = new Map<string, { clientId: string; clientName: string; totalMinor: number; lateMinor: number; oldest: AgingBucket }>();
  for (const i of invoices) {
    if (i.balanceMinor <= 0) continue;
    const bucket = agingBucket(i.dueKey, todayKey);
    buckets[bucket] += i.balanceMinor;
    const c = clients.get(i.clientId) ?? { clientId: i.clientId, clientName: i.clientName, totalMinor: 0, lateMinor: 0, oldest: "current" as AgingBucket };
    c.totalMinor += i.balanceMinor;
    if (bucket !== "current") c.lateMinor += i.balanceMinor;
    if (AGING_BUCKETS.indexOf(bucket) > AGING_BUCKETS.indexOf(c.oldest)) c.oldest = bucket;
    clients.set(i.clientId, c);
  }
  const totalMinor = Object.values(buckets).reduce((s, v) => s + v, 0);
  return { totalMinor, buckets: AGING_BUCKETS.map((b) => ({ bucket: b, label: AGING_LABEL[b], amountMinor: buckets[b] })), byClient: [...clients.values()].sort((a, b) => b.totalMinor - a.totalMinor) };
}
