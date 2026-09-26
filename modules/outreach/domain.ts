/**
 * Outreach tracking (Phase 3 scope 5) — pure, and tested to reconcile exactly
 * with the logged activities (tests/outreach-domain.test.ts). Formulas in
 * docs/METRICS.md.
 *
 * Every number here is a count of `SalesActivity` rows. Nothing is stored
 * pre-aggregated, so a rollup can never disagree with the timeline it
 * summarises: a row either counts toward exactly one outreach kind or toward
 * none.
 */

export const OUTREACH_KINDS = [
  "coldCalls",
  "emailsSent",
  "emailsReplied",
  "followUps",
  "meetingsBooked",
  "meetingsCompleted",
  "proposalsSent",
  "dealsClosed",
] as const;
export type OutreachKind = (typeof OUTREACH_KINDS)[number];

export const OUTREACH_LABEL: Record<OutreachKind, string> = {
  coldCalls: "Cold calls",
  emailsSent: "Emails sent",
  emailsReplied: "Emails replied",
  followUps: "Follow-ups",
  meetingsBooked: "Meetings booked",
  meetingsCompleted: "Meetings completed",
  proposalsSent: "Proposals sent",
  dealsClosed: "Deals closed",
};

/**
 * Which outreach kind a logged activity type counts as, or null. The new
 * explicit types are what people log from Phase 3 on; the older generic ones
 * (CALL, EMAIL, MEETING, QUOTE) keep counting as the nearest kind so history
 * logged before Phase 3 is not lost from the numbers.
 */
const KIND_OF: Readonly<Record<string, OutreachKind>> = {
  COLD_CALL: "coldCalls",
  CALL: "coldCalls",
  EMAIL_SENT: "emailsSent",
  EMAIL: "emailsSent",
  EMAIL_REPLY: "emailsReplied",
  FOLLOW_UP: "followUps",
  MEETING_BOOKED: "meetingsBooked",
  MEETING_HELD: "meetingsCompleted",
  MEETING: "meetingsCompleted",
  PROPOSAL_SENT: "proposalsSent",
  QUOTE: "proposalsSent",
  DEAL_CLOSED: "dealsClosed",
};

export function outreachKindOf(type: string): OutreachKind | null {
  return KIND_OF[type] ?? null;
}

/** Activity types that count toward outreach, in any spelling. */
export const OUTREACH_ACTIVITY_TYPES = Object.keys(KIND_OF);

export type Period = "day" | "week" | "month";

function localParts(instant: Date, timeZone: string) {
  const f = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(instant);
  const get = (t: string) => Number(f.find((p) => p.type === t)?.value);
  return { y: get("year"), m: get("month"), d: get("day") };
}

const iso = (y: number, m: number, d: number) =>
  `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;

/**
 * The bucket an instant falls in, on the company calendar: the day
 * ("2026-09-26"), the Monday that starts its week ("2026-09-21"), or the
 * month ("2026-09").
 */
export function bucketOf(instant: Date, period: Period, timeZone: string): string {
  const { y, m, d } = localParts(instant, timeZone);
  if (period === "month") return `${y}-${String(m).padStart(2, "0")}`;
  if (period === "day") return iso(y, m, d);
  const weekday = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0 = Sunday
  const monday = new Date(Date.UTC(y, m - 1, d - ((weekday + 6) % 7)));
  return iso(monday.getUTCFullYear(), monday.getUTCMonth() + 1, monday.getUTCDate());
}

export type OutreachCounts = Record<OutreachKind, number>;

export const emptyCounts = (): OutreachCounts =>
  Object.fromEntries(OUTREACH_KINDS.map((k) => [k, 0])) as OutreachCounts;

export type ActivityRow = { type: string; occurredAt: Date; userId: string };

export type Rollup = {
  period: Period;
  /** Buckets present in the data, newest first. */
  buckets: { key: string; total: OutreachCounts; byUser: Record<string, OutreachCounts> }[];
  total: OutreachCounts;
  byUser: Record<string, OutreachCounts>;
};

/**
 * Counts per bucket, per person and overall. Every counted row lands in
 * exactly one bucket, one person and one kind, so Σ buckets = Σ people =
 * total = the number of outreach rows — the reconciliation the tests pin.
 */
export function rollup(rows: readonly ActivityRow[], period: Period, timeZone: string): Rollup {
  const buckets = new Map<string, { total: OutreachCounts; byUser: Record<string, OutreachCounts> }>();
  const total = emptyCounts();
  const byUser: Record<string, OutreachCounts> = {};

  for (const row of rows) {
    const kind = outreachKindOf(row.type);
    if (!kind) continue;
    const key = bucketOf(row.occurredAt, period, timeZone);
    const bucket = buckets.get(key) ?? { total: emptyCounts(), byUser: {} };
    bucket.total[kind] += 1;
    (bucket.byUser[row.userId] ??= emptyCounts())[kind] += 1;
    buckets.set(key, bucket);
    total[kind] += 1;
    (byUser[row.userId] ??= emptyCounts())[kind] += 1;
  }

  return {
    period,
    buckets: [...buckets.entries()]
      .sort(([a], [b]) => (a < b ? 1 : -1))
      .map(([key, b]) => ({ key, ...b })),
    total,
    byUser,
  };
}

export const sumCounts = (c: OutreachCounts) => OUTREACH_KINDS.reduce((t, k) => t + c[k], 0);
