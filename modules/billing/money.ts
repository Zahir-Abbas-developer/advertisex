/**
 * Money, as integer minor units (cents). Pure: no database, no clock.
 *
 * Nothing in billing ever holds an amount as a float. Input is parsed from
 * text straight into integers, arithmetic that could exceed 2^53 is done in
 * BigInt, and formatting builds the decimal string from integers before Intl
 * adds the currency symbol. The rules are documented in docs/METRICS.md →
 * "Money".
 */

/** Currencies we invoice in, with their minor-unit exponent. */
export const CURRENCIES = {
  USD: 2,
  EUR: 2,
  GBP: 2,
  CAD: 2,
  AUD: 2,
  AED: 2,
  INR: 2,
  PKR: 2,
} as const;
export type Currency = keyof typeof CURRENCIES;
export const CURRENCY_CODES = Object.keys(CURRENCIES) as Currency[];

export function isCurrency(value: string): value is Currency {
  return Object.prototype.hasOwnProperty.call(CURRENCIES, value);
}

/** Largest rate on a line: 10,000,000.00. */
export const MAX_RATE_MINOR = 1_000_000_000;
/** Largest quantity on a line: 100,000 units (in thousandths). */
export const MAX_QUANTITY_MILLI = 100_000_000;
/** Largest invoice total: 10,000,000,000.00 — far inside 2^53. */
export const MAX_TOTAL_MINOR = 1_000_000_000_000;

type Parsed = { ok: true; value: number } | { ok: false; error: string };

/**
 * "1,234.5" → 123450. Accepts thousands commas and at most two decimals;
 * never goes through a float. Negative only when `allowNegative` (a
 * discount line's rate).
 */
export function parseMoney(input: string, opts: { allowNegative?: boolean; allowZero?: boolean } = {}): Parsed {
  const text = input.trim().replace(/,/g, "").replace(/\s+/g, "");
  const match = /^(-)?(\d{1,13})(?:\.(\d{0,2}))?$/.exec(text);
  if (!match) return { ok: false, error: "Enter an amount like 1,250.00" };
  const [, minus, whole, frac = ""] = match;
  if (minus && !opts.allowNegative) return { ok: false, error: "The amount can't be negative" };
  const magnitude = Number(whole) * 100 + Number(frac.padEnd(2, "0"));
  const value = minus ? -magnitude : magnitude;
  if (value === 0 && !opts.allowZero) return { ok: false, error: "The amount must be more than zero" };
  if (Math.abs(value) > MAX_RATE_MINOR) return { ok: false, error: "That amount is too large" };
  return { ok: true, value: Object.is(value, -0) ? 0 : value };
}

/** "1.5" → 1500 thousandths. Positive, at most three decimals. */
export function parseQuantity(input: string): Parsed {
  const text = input.trim().replace(/,/g, "");
  const match = /^(\d{1,6})(?:\.(\d{0,3}))?$/.exec(text);
  if (!match) return { ok: false, error: "Enter a quantity like 1 or 1.5" };
  const [, whole, frac = ""] = match;
  const value = Number(whole) * 1000 + Number(frac.padEnd(3, "0"));
  if (value <= 0) return { ok: false, error: "The quantity must be more than zero" };
  if (value > MAX_QUANTITY_MILLI) return { ok: false, error: "That quantity is too large" };
  return { ok: true, value };
}

/** Integer division of a BigInt, rounding half away from zero. */
function divRound(n: bigint, d: bigint): bigint {
  const negative = n < 0n !== d < 0n;
  const an = n < 0n ? -n : n;
  const ad = d < 0n ? -d : d;
  const q = (an * 2n + ad) / (ad * 2n);
  return negative ? -q : q;
}

/**
 * A line's amount: quantity × rate, rounded to the minor unit, half away
 * from zero (1.5 cents → 2 cents; −1.5 → −2). Each line is rounded once;
 * the invoice total is the plain sum of the rounded lines.
 */
export function lineAmount(quantityMilli: number, rateMinor: number): number {
  return Number(divRound(BigInt(quantityMilli) * BigInt(rateMinor), 1000n));
}

/** `minor ÷ divisor`, rounded half away from zero — used for MRR (quarterly ÷ 3, yearly ÷ 12). */
export function divideMinor(minor: number, divisor: number): number {
  return Number(divRound(BigInt(minor), BigInt(divisor)));
}

/**
 * Splits `amount` across `weights` exactly (largest remainder): each share
 * is floor(amount × weight ÷ Σweights), and the leftover cents go, one each,
 * to the largest fractional remainders (earlier index wins a tie). The
 * shares always sum to `amount`. Zero or negative weights get nothing; if
 * every weight is zero the amount goes to the first entry.
 */
export function allocate(amount: number, weights: readonly number[]): number[] {
  if (weights.length === 0) return [];
  const w = weights.map((x) => (x > 0 ? BigInt(x) : 0n));
  const total = w.reduce((a, b) => a + b, 0n);
  if (total === 0n) return weights.map((_, i) => (i === 0 ? amount : 0));
  const sign = amount < 0 ? -1n : 1n;
  const a = BigInt(Math.abs(amount));
  const shares = w.map((x) => (a * x) / total);
  const remainders = w.map((x, i) => ({ i, r: (a * x) % total }));
  let left = a - shares.reduce((s, x) => s + x, 0n);
  remainders.sort((p, q) => (q.r > p.r ? 1 : q.r < p.r ? -1 : p.i - q.i));
  for (const { i } of remainders) {
    if (left === 0n) break;
    if (w[i] === 0n) continue;
    shares[i] += 1n;
    left -= 1n;
  }
  return shares.map((x) => Number(x * sign));
}

/** 123450 → "1234.50" (exact; no float). */
export function toDecimalString(minor: number): string {
  const negative = minor < 0;
  const abs = Math.abs(minor);
  const s = `${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
  return negative ? `-${s}` : s;
}

/** 123450, "USD" → "$1,234.50". `whole` drops the cents for headline figures. */
export function formatMoney(minor: number, currency: string = "USD", opts: { whole?: boolean } = {}): string {
  const code = isCurrency(currency) ? currency : "USD";
  const nf = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: code,
    minimumFractionDigits: opts.whole ? 0 : 2,
    maximumFractionDigits: opts.whole ? 0 : 2,
  });
  // Intl accepts an exact decimal string (Intl.NumberFormat v3), so the
  // amount never becomes a binary float on its way to the screen.
  const decimal = opts.whole ? String(divideMinor(minor, 100)) : toDecimalString(minor);
  return nf.format(decimal as unknown as number);
}

/** A quantity in thousandths, for display: 1500 → "1.5". */
export function formatQuantity(milli: number): string {
  const whole = Math.floor(milli / 1000);
  const frac = String(milli % 1000).padStart(3, "0").replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : String(whole);
}
