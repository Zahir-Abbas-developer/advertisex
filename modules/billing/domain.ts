/**
 * Invoice rules: statuses, totals, what can happen when, and the pure
 * arithmetic behind the financial overview. No database, no clock — dates
 * arrive as company-calendar keys ("YYYY-MM-DD"), so every rule is testable.
 */

import { allocate, divideMinor, lineAmount, MAX_TOTAL_MINOR, parseMoney, parseQuantity } from "@/modules/billing/money";

export const INVOICE_STATUSES = ["DRAFT", "SENT", "PARTIALLY_PAID", "PAID", "OVERDUE", "VOID"] as const;
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];

export const INVOICE_STATUS_LABEL: Record<InvoiceStatus, string> = {
  DRAFT: "Draft",
  SENT: "Sent",
  PARTIALLY_PAID: "Partially paid",
  PAID: "Paid",
  OVERDUE: "Overdue",
  VOID: "Void",
};

export const INVOICE_STATUS_TONE: Record<InvoiceStatus, "neutral" | "info" | "warning" | "success" | "danger"> = {
  DRAFT: "neutral",
  SENT: "info",
  PARTIALLY_PAID: "warning",
  PAID: "success",
  OVERDUE: "danger",
  VOID: "neutral",
};

/** Sent and not settled: money is still owed. */
export const OPEN_STATUSES: readonly InvoiceStatus[] = ["SENT", "PARTIALLY_PAID", "OVERDUE"];

export const PAYMENT_METHODS = ["BANK_TRANSFER", "CARD", "CASH", "CHECK", "OTHER"] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];
export const PAYMENT_METHOD_LABEL: Record<PaymentMethod, string> = {
  BANK_TRANSFER: "Bank transfer",
  CARD: "Card",
  CASH: "Cash",
  CHECK: "Check",
  OTHER: "Other",
};

export function isInvoiceStatus(value: string): value is InvoiceStatus {
  return (INVOICE_STATUSES as readonly string[]).includes(value);
}

export type LineInput = { quantityMilli: number; rateMinor: number };

/** Each line rounded once; the total is the plain sum of rounded lines (no tax in this phase). */
export function invoiceTotals(lines: readonly LineInput[]): { lines: number[]; subtotalMinor: number; totalMinor: number } {
  const amounts = lines.map((l) => lineAmount(l.quantityMilli, l.rateMinor));
  const subtotalMinor = amounts.reduce((s, a) => s + a, 0);
  return { lines: amounts, subtotalMinor, totalMinor: subtotalMinor };
}

export type RawLine = { serviceId?: string | null; description: string; quantity: string; rate: string };
export type ParsedLine = { serviceId: string | null; description: string; quantityMilli: number; rateMinor: number; amountMinor: number; position: number };

/**
 * Lines as typed (text) → integer lines with their amounts, or field errors
 * keyed "lines.<i>.<field>". A rate may be negative (a discount line).
 */
export function parseLines(raw: readonly RawLine[]): { ok: true; lines: ParsedLine[] } | { ok: false; errors: Record<string, string> } {
  const errors: Record<string, string> = {};
  const lines: ParsedLine[] = [];
  if (raw.length === 0) errors.lines = "Add at least one line";
  if (raw.length > 100) errors.lines = "At most 100 lines";
  raw.slice(0, 100).forEach((l, i) => {
    const description = l.description.trim();
    if (!description) errors[`lines.${i}.description`] = "Describe the work";
    if (description.length > 300) errors[`lines.${i}.description`] = "At most 300 characters";
    const q = parseQuantity(l.quantity);
    const r = parseMoney(l.rate, { allowNegative: true });
    if (!q.ok) errors[`lines.${i}.quantity`] = q.error;
    if (!r.ok) errors[`lines.${i}.rate`] = r.error;
    if (q.ok && r.ok) {
      lines.push({ serviceId: l.serviceId || null, description, quantityMilli: q.value, rateMinor: r.value, amountMinor: lineAmount(q.value, r.value), position: i });
    }
  });
  if (Object.keys(errors).length) return { ok: false, errors };
  const total = lines.reduce((s, l) => s + l.amountMinor, 0);
  if (total > MAX_TOTAL_MINOR) return { ok: false, errors: { lines: "The total is too large" } };
  return { ok: true, lines };
}

/** Why a draft can't be sent yet, or null when it can. */
export function sendBlocker(input: { status: string; totalMinor: number; lineCount: number }): string | null {
  if (input.status !== "DRAFT") return "Only a draft can be sent";
  if (input.lineCount === 0) return "Add at least one line";
  if (input.totalMinor <= 0) return "The total must be more than zero";
  if (input.totalMinor > MAX_TOTAL_MINOR) return "The total is too large";
  return null;
}

/**
 * The status an invoice should have now. DRAFT and VOID are set by people and
 * never change here. Otherwise, by the money and the date:
 *
 *   fully paid                          → PAID
 *   past its due date with a balance    → OVERDUE   (even if partly paid)
 *   something paid, not past due        → PARTIALLY_PAID
 *   nothing paid, not past due          → SENT
 *
 * "Past due" means the company-calendar day after the due date: an invoice
 * due today is not overdue until tomorrow.
 */
export function deriveStatus(input: { status: string; totalMinor: number; paidMinor: number; dueKey: string }, todayKey: string): InvoiceStatus {
  if (input.status === "DRAFT" || input.status === "VOID") return input.status;
  if (input.paidMinor >= input.totalMinor) return "PAID";
  if (todayKey > input.dueKey) return "OVERDUE";
  if (input.paidMinor > 0) return "PARTIALLY_PAID";
  return "SENT";
}

export const balanceOf = (inv: { totalMinor: number; paidMinor: number; status: string }): number =>
  inv.status === "DRAFT" || inv.status === "VOID" ? 0 : Math.max(0, inv.totalMinor - inv.paidMinor);

/** Why a payment can't be recorded, or null. Over-payment is refused, not stored as credit. */
export function paymentBlocker(inv: { status: string; totalMinor: number; paidMinor: number }, amountMinor: number): string | null {
  if (inv.status === "DRAFT") return "Send the invoice before recording a payment";
  if (inv.status === "VOID") return "This invoice is void";
  if (inv.status === "PAID") return "This invoice is already paid";
  if (!Number.isSafeInteger(amountMinor) || amountMinor <= 0) return "The amount must be more than zero";
  if (amountMinor > inv.totalMinor - inv.paidMinor) return "That's more than the balance due";
  return null;
}

/** A sent invoice with no payments against it can be voided; a paid or part-paid one can't until its payments are reversed. */
export function voidBlocker(inv: { status: string; paidMinor: number }): string | null {
  if (inv.status === "DRAFT") return "Delete a draft instead of voiding it";
  if (inv.status === "VOID") return "Already void";
  if (inv.paidMinor > 0) return "Reverse its payments first";
  return null;
}

export const numberLabel = (prefix: string, n: number): string => `${prefix || "INV"}-${String(n).padStart(4, "0")}`;

// ---------------------------------------------------------------------------
// Calendar keys
// ---------------------------------------------------------------------------

/** "YYYY-MM-DD" of an instant on the company clock. */
export function dayKey(at: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(at);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/** A date-only value (stored as UTC midnight) as its key. */
export const dateOnlyKey = (d: Date): string => d.toISOString().slice(0, 10);

/** The last `count` month keys ("YYYY-MM") ending with the month of `todayKey`, oldest first. */
export function lastMonths(todayKey: string, count: number): string[] {
  let y = Number(todayKey.slice(0, 4));
  let m = Number(todayKey.slice(5, 7));
  const out: string[] = [];
  for (let i = 0; i < count; i++) {
    out.unshift(`${y}-${String(m).padStart(2, "0")}`);
    m -= 1;
    if (m === 0) {
      m = 12;
      y -= 1;
    }
  }
  return out;
}

export const RANGES = ["month", "quarter", "year", "12m"] as const;
export type Range = (typeof RANGES)[number];
export const RANGE_LABEL: Record<Range, string> = { month: "This month", quarter: "This quarter", year: "This year", "12m": "Last 12 months" };

/** Inclusive day-key bounds of a range, on the company calendar. */
export function rangeBounds(range: Range, todayKey: string): { from: string; to: string } {
  const y = Number(todayKey.slice(0, 4));
  const m = Number(todayKey.slice(5, 7));
  const pad = (n: number) => String(n).padStart(2, "0");
  if (range === "month") return { from: `${y}-${pad(m)}-01`, to: todayKey };
  if (range === "quarter") return { from: `${y}-${pad(Math.floor((m - 1) / 3) * 3 + 1)}-01`, to: todayKey };
  if (range === "year") return { from: `${y}-01-01`, to: todayKey };
  const first = lastMonths(todayKey, 12)[0];
  return { from: `${first}-01`, to: todayKey };
}

// ---------------------------------------------------------------------------
// MRR
// ---------------------------------------------------------------------------

export type RecurringService = { priceWhole: number; billing: string; status: string };

/**
 * A service's monthly value in minor units: monthly price as is, quarterly
 * ÷ 3, yearly ÷ 12 (each rounded half away from zero); one-time and
 * anything not ACTIVE is 0. Prices on ClientService are whole units, so ×100.
 */
export function monthlyMinor(s: RecurringService): number {
  if (s.status !== "ACTIVE") return 0;
  const minor = s.priceWhole * 100;
  if (s.billing === "MONTHLY") return minor;
  if (s.billing === "QUARTERLY") return divideMinor(minor, 3);
  if (s.billing === "YEARLY") return divideMinor(minor, 12);
  return 0;
}

/** MRR = Σ monthlyMinor over the organization's client services. */
export const mrrMinor = (services: readonly RecurringService[]): number => services.reduce((sum, s) => sum + monthlyMinor(s), 0);

// ---------------------------------------------------------------------------
// The financial overview (pure; the server feeds it rows)
// ---------------------------------------------------------------------------

export type OverviewInvoice = {
  id: string;
  clientId: string;
  clientName: string;
  status: InvoiceStatus;
  currency: string;
  totalMinor: number;
  paidMinor: number;
  issueKey: string | null;
  lines: { serviceId: string | null; serviceName: string | null; amountMinor: number }[];
};

export type OverviewPayment = { invoiceId: string; amountMinor: number; paidKey: string; reversed: boolean };

export type Overview = {
  currency: string;
  range: { from: string; to: string };
  receivedMinor: number;
  invoicedMinor: number;
  pendingMinor: number;
  overdueMinor: number;
  outstandingMinor: number;
  counts: { pending: number; overdue: number; paidInRange: number; otherCurrency: number };
  byClient: { clientId: string; clientName: string; amountMinor: number }[];
  byService: { key: string; name: string; amountMinor: number }[];
  trend: { month: string; receivedMinor: number; invoicedMinor: number }[];
};

const OTHER = { key: "other", name: "Other work" };

/**
 * One invoice's service split: each service's share is its positive line
 * amounts (discount lines reduce every service in proportion).
 */
function serviceWeights(inv: OverviewInvoice): { key: string; name: string; weight: number }[] {
  const map = new Map<string, { key: string; name: string; weight: number }>();
  for (const l of inv.lines) {
    if (l.amountMinor <= 0) continue;
    const key = l.serviceId ?? OTHER.key;
    const entry = map.get(key) ?? { key, name: l.serviceName ?? OTHER.name, weight: 0 };
    entry.weight += l.amountMinor;
    map.set(key, entry);
  }
  return [...map.values()];
}

/**
 * Revenue is money received: the payments (not reversed) dated in the range.
 * By client, each payment counts to its invoice's client; by service, each
 * payment is split across its invoice's services by `allocate`, so both
 * breakdowns sum exactly to `receivedMinor`. Pending, overdue and
 * outstanding are balances *now*, whatever the range. Only invoices in the
 * organization's currency are counted; others are counted and reported.
 */
export function buildOverview(input: {
  currency: string;
  todayKey: string;
  range: Range;
  invoices: readonly OverviewInvoice[];
  payments: readonly OverviewPayment[];
  trendMonths?: number;
}): Overview {
  const bounds = rangeBounds(input.range, input.todayKey);
  const inRange = (key: string) => key >= bounds.from && key <= bounds.to;
  const invoices = input.invoices.filter((i) => i.currency === input.currency);
  const byId = new Map(invoices.map((i) => [i.id, i]));
  const payments = input.payments.filter((p) => !p.reversed && byId.has(p.invoiceId));

  let pendingMinor = 0;
  let overdueMinor = 0;
  let pending = 0;
  let overdue = 0;
  let invoicedMinor = 0;
  for (const inv of invoices) {
    const balance = balanceOf(inv);
    if (inv.status === "OVERDUE") {
      overdueMinor += balance;
      overdue += 1;
    } else if (inv.status === "SENT" || inv.status === "PARTIALLY_PAID") {
      pendingMinor += balance;
      pending += 1;
    }
    if (inv.status !== "DRAFT" && inv.status !== "VOID" && inv.issueKey && inRange(inv.issueKey)) invoicedMinor += inv.totalMinor;
  }

  const clients = new Map<string, { clientId: string; clientName: string; amountMinor: number }>();
  const services = new Map<string, { key: string; name: string; amountMinor: number }>();
  let receivedMinor = 0;
  const paidInvoices = new Set<string>();
  for (const p of payments) {
    if (!inRange(p.paidKey)) continue;
    const inv = byId.get(p.invoiceId)!;
    receivedMinor += p.amountMinor;
    paidInvoices.add(inv.id);
    const c = clients.get(inv.clientId) ?? { clientId: inv.clientId, clientName: inv.clientName, amountMinor: 0 };
    c.amountMinor += p.amountMinor;
    clients.set(inv.clientId, c);
    const weights = serviceWeights(inv);
    const parts = weights.length ? allocate(p.amountMinor, weights.map((w) => w.weight)) : [p.amountMinor];
    const targets = weights.length ? weights : [{ ...OTHER, weight: 1 }];
    targets.forEach((t, i) => {
      const s = services.get(t.key) ?? { key: t.key, name: t.name, amountMinor: 0 };
      s.amountMinor += parts[i];
      services.set(t.key, s);
    });
  }

  const months = lastMonths(input.todayKey, input.trendMonths ?? 12);
  const trend = months.map((month) => ({ month, receivedMinor: 0, invoicedMinor: 0 }));
  const slot = new Map(trend.map((t) => [t.month, t]));
  for (const p of payments) {
    const t = slot.get(p.paidKey.slice(0, 7));
    if (t) t.receivedMinor += p.amountMinor;
  }
  for (const inv of invoices) {
    if (inv.status === "DRAFT" || inv.status === "VOID" || !inv.issueKey) continue;
    const t = slot.get(inv.issueKey.slice(0, 7));
    if (t) t.invoicedMinor += inv.totalMinor;
  }

  const desc = <T extends { amountMinor: number }>(a: T, b: T) => b.amountMinor - a.amountMinor;
  return {
    currency: input.currency,
    range: bounds,
    receivedMinor,
    invoicedMinor,
    pendingMinor,
    overdueMinor,
    outstandingMinor: pendingMinor + overdueMinor,
    counts: { pending, overdue, paidInRange: paidInvoices.size, otherCurrency: input.invoices.length - invoices.length },
    byClient: [...clients.values()].sort(desc),
    byService: [...services.values()].sort(desc),
    trend,
  };
}
