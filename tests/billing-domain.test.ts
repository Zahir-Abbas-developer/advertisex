import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  allocate,
  divideMinor,
  formatMoney,
  formatQuantity,
  lineAmount,
  parseMoney,
  parseQuantity,
  toDecimalString,
} from "../modules/billing/money";
import {
  balanceOf,
  buildOverview,
  dayKey,
  deriveStatus,
  invoiceTotals,
  lastMonths,
  monthlyMinor,
  mrrMinor,
  numberLabel,
  paymentBlocker,
  rangeBounds,
  sendBlocker,
  voidBlocker,
  type OverviewInvoice,
} from "../modules/billing/domain";

describe("money is integers", () => {
  it("parses text straight to minor units, never through a float", () => {
    assert.deepEqual(parseMoney("1,234.5"), { ok: true, value: 123450 });
    assert.deepEqual(parseMoney("0.10"), { ok: true, value: 10 });
    assert.deepEqual(parseMoney("19.99"), { ok: true, value: 1999 });
    // 0.1 + 0.2 as floats is 0.30000000000000004; as text it is exact.
    assert.equal((parseMoney("0.1") as { value: number }).value + (parseMoney("0.2") as { value: number }).value, 30);
    assert.equal(parseMoney("1.234").ok, false, "at most two decimals");
    assert.equal(parseMoney("-5").ok, false, "negative only when allowed");
    assert.deepEqual(parseMoney("-5", { allowNegative: true }), { ok: true, value: -500 });
    assert.equal(parseMoney("0").ok, false);
    assert.equal(parseMoney("abc").ok, false);
    assert.equal(parseMoney("10000000.01").ok, false, "over the rate cap");
  });

  it("parses quantities in thousandths", () => {
    assert.deepEqual(parseQuantity("1.5"), { ok: true, value: 1500 });
    assert.deepEqual(parseQuantity("3"), { ok: true, value: 3000 });
    assert.equal(parseQuantity("0").ok, false);
    assert.equal(parseQuantity("1.2345").ok, false);
    assert.equal(formatQuantity(1500), "1.5");
    assert.equal(formatQuantity(3000), "3");
    assert.equal(formatQuantity(1250), "1.25");
  });

  it("rounds each line once, half away from zero", () => {
    assert.equal(lineAmount(1000, 12345), 12345);
    assert.equal(lineAmount(1500, 1001), 1502, "1.5 × 10.01 = 15.015 → 15.02");
    assert.equal(lineAmount(333, 100), 33, "0.333 × 1.00 = 0.333 → 0.33");
    assert.equal(lineAmount(1500, 1), 2, "0.0015 → 0.002: half rounds up");
    assert.equal(lineAmount(1500, -1001), -1502, "a discount rounds away from zero too");
    assert.equal(lineAmount(100_000_000, 1_000_000_000), 100_000_000_000_000, "the largest line is exact (BigInt)");
  });

  it("totals are the sum of the rounded lines", () => {
    const t = invoiceTotals([
      { quantityMilli: 1000, rateMinor: 250000 },
      { quantityMilli: 1500, rateMinor: 1001 },
      { quantityMilli: 1000, rateMinor: -5000 },
    ]);
    assert.deepEqual(t.lines, [250000, 1502, -5000]);
    assert.equal(t.subtotalMinor, 246502);
    assert.equal(t.totalMinor, 246502);
  });

  it("allocates exactly, by largest remainder", () => {
    assert.deepEqual(allocate(100, [1, 1, 1]), [34, 33, 33]);
    assert.deepEqual(allocate(1000, [3, 1]), [750, 250]);
    assert.deepEqual(allocate(1, [1, 1]), [1, 0]);
    assert.deepEqual(allocate(10, [0, 5]), [0, 10]);
    assert.deepEqual(allocate(7, [0, 0]), [7, 0]);
    for (const [amount, weights] of [[99_999, [7, 13, 29]], [1, [5, 5, 5]], [123_457, [250_000, 1502, 3]]] as const) {
      assert.equal(allocate(amount, weights).reduce((a, b) => a + b, 0), amount);
    }
  });

  it("formats from integers", () => {
    assert.equal(toDecimalString(123450), "1234.50");
    assert.equal(toDecimalString(-5), "-0.05");
    assert.equal(formatMoney(123450, "USD"), "$1,234.50");
    assert.equal(formatMoney(123450, "USD", { whole: true }), "$1,235");
    assert.equal(formatMoney(5, "EUR"), "€0.05");
    assert.equal(divideMinor(100, 3), 33);
    assert.equal(divideMinor(200, 3), 67);
  });
});

describe("invoice lifecycle", () => {
  const sent = { status: "SENT", totalMinor: 10000, paidMinor: 0, dueKey: "2026-10-15" };

  it("moves Sent → Partially paid → Paid with payments", () => {
    assert.equal(deriveStatus(sent, "2026-10-01"), "SENT");
    assert.equal(deriveStatus({ ...sent, paidMinor: 4000 }, "2026-10-01"), "PARTIALLY_PAID");
    assert.equal(deriveStatus({ ...sent, paidMinor: 10000 }, "2026-10-01"), "PAID");
    assert.equal(deriveStatus({ ...sent, paidMinor: 10000 }, "2026-12-01"), "PAID", "paid stays paid after the due date");
  });

  it("goes overdue the day after its due date, part-paid or not", () => {
    assert.equal(deriveStatus(sent, "2026-10-15"), "SENT", "due today is not overdue");
    assert.equal(deriveStatus(sent, "2026-10-16"), "OVERDUE");
    assert.equal(deriveStatus({ ...sent, paidMinor: 4000 }, "2026-10-16"), "OVERDUE");
    assert.equal(deriveStatus({ ...sent, paidMinor: 4000 }, "2026-10-16") === "OVERDUE" && balanceOf({ ...sent, paidMinor: 4000 }), 6000);
  });

  it("never changes a draft or a void invoice", () => {
    assert.equal(deriveStatus({ ...sent, status: "DRAFT" }, "2027-01-01"), "DRAFT");
    assert.equal(deriveStatus({ ...sent, status: "VOID", paidMinor: 10000 }, "2027-01-01"), "VOID");
    assert.equal(balanceOf({ status: "VOID", totalMinor: 100, paidMinor: 0 }), 0);
    assert.equal(balanceOf({ status: "DRAFT", totalMinor: 100, paidMinor: 0 }), 0);
  });

  it("refuses payments that don't fit", () => {
    const inv = { status: "PARTIALLY_PAID", totalMinor: 10000, paidMinor: 4000 };
    assert.equal(paymentBlocker(inv, 6000), null);
    assert.match(paymentBlocker(inv, 6001)!, /more than the balance/);
    assert.match(paymentBlocker(inv, 0)!, /more than zero/);
    assert.match(paymentBlocker(inv, 1.5)!, /more than zero/, "fractions of a cent are not money");
    assert.match(paymentBlocker({ ...inv, status: "DRAFT" }, 100)!, /Send the invoice/);
    assert.match(paymentBlocker({ ...inv, status: "VOID" }, 100)!, /void/);
    assert.match(paymentBlocker({ status: "PAID", totalMinor: 1, paidMinor: 1 }, 1)!, /already paid/);
  });

  it("sends only a draft with a positive total; voids only what has no payments", () => {
    assert.equal(sendBlocker({ status: "DRAFT", totalMinor: 1, lineCount: 1 }), null);
    assert.ok(sendBlocker({ status: "DRAFT", totalMinor: 0, lineCount: 1 }));
    assert.ok(sendBlocker({ status: "DRAFT", totalMinor: 100, lineCount: 0 }));
    assert.ok(sendBlocker({ status: "SENT", totalMinor: 100, lineCount: 1 }));
    assert.equal(voidBlocker({ status: "OVERDUE", paidMinor: 0 }), null);
    assert.ok(voidBlocker({ status: "PARTIALLY_PAID", paidMinor: 1 }));
    assert.ok(voidBlocker({ status: "DRAFT", paidMinor: 0 }));
    assert.equal(numberLabel("INV", 7), "INV-0007");
    assert.equal(numberLabel("AX", 12345), "AX-12345");
  });
});

describe("calendar and MRR", () => {
  it("keys days on the company clock", () => {
    const late = new Date("2026-10-01T03:00:00Z");
    assert.equal(dayKey(late, "America/New_York"), "2026-09-30");
    assert.equal(dayKey(late, "Asia/Karachi"), "2026-10-01");
    assert.deepEqual(lastMonths("2026-02-10", 3), ["2025-12", "2026-01", "2026-02"]);
    assert.deepEqual(rangeBounds("quarter", "2026-08-20"), { from: "2026-07-01", to: "2026-08-20" });
    assert.deepEqual(rangeBounds("12m", "2026-08-20"), { from: "2025-09-01", to: "2026-08-20" });
  });

  it("counts recurring services at their monthly value", () => {
    assert.equal(monthlyMinor({ priceWhole: 1200, billing: "MONTHLY", status: "ACTIVE" }), 120000);
    assert.equal(monthlyMinor({ priceWhole: 1000, billing: "QUARTERLY", status: "ACTIVE" }), 33333);
    assert.equal(monthlyMinor({ priceWhole: 100, billing: "YEARLY", status: "ACTIVE" }), 833);
    assert.equal(monthlyMinor({ priceWhole: 5000, billing: "ONE_TIME", status: "ACTIVE" }), 0);
    assert.equal(monthlyMinor({ priceWhole: 1200, billing: "MONTHLY", status: "PAUSED" }), 0);
    assert.equal(
      mrrMinor([
        { priceWhole: 1200, billing: "MONTHLY", status: "ACTIVE" },
        { priceWhole: 1000, billing: "QUARTERLY", status: "ACTIVE" },
        { priceWhole: 900, billing: "MONTHLY", status: "ENDED" },
      ]),
      153333,
    );
  });
});

describe("the financial overview reconciles", () => {
  const inv = (o: Partial<OverviewInvoice> & { id: string }): OverviewInvoice => ({
    clientId: "c1",
    clientName: "Osteria",
    status: "SENT",
    currency: "USD",
    totalMinor: 10000,
    paidMinor: 0,
    issueKey: "2026-09-01",
    lines: [{ serviceId: "web", serviceName: "Websites", amountMinor: 10000 }],
    ...o,
  });
  const invoices = [
    inv({ id: "a", status: "PAID", paidMinor: 10000, lines: [{ serviceId: "web", serviceName: "Websites", amountMinor: 7000 }, { serviceId: "seo", serviceName: "SEO", amountMinor: 3001 }, { serviceId: null, serviceName: null, amountMinor: -1 }] }),
    inv({ id: "b", clientId: "c2", clientName: "Bao", status: "PARTIALLY_PAID", paidMinor: 3333, totalMinor: 9999 }),
    inv({ id: "c", clientId: "c2", clientName: "Bao", status: "OVERDUE", paidMinor: 0, totalMinor: 5000, issueKey: "2026-07-10" }),
    inv({ id: "d", status: "DRAFT", issueKey: null }),
    inv({ id: "e", status: "VOID" }),
    inv({ id: "f", currency: "EUR", status: "SENT" }),
  ];
  const payments = [
    { invoiceId: "a", amountMinor: 5000, paidKey: "2026-09-05", reversed: false },
    { invoiceId: "a", amountMinor: 5000, paidKey: "2026-09-20", reversed: false },
    { invoiceId: "a", amountMinor: 777, paidKey: "2026-09-21", reversed: true },
    { invoiceId: "b", amountMinor: 3333, paidKey: "2026-08-31", reversed: false },
    { invoiceId: "f", amountMinor: 100, paidKey: "2026-09-02", reversed: false },
  ];
  const o = buildOverview({ currency: "USD", todayKey: "2026-09-28", range: "month", invoices, payments });

  it("revenue by client and by service both sum to money received", () => {
    assert.equal(o.receivedMinor, 10000, "September's two payments; the reversed one and August's excluded");
    assert.equal(o.byClient.reduce((s, c) => s + c.amountMinor, 0), o.receivedMinor);
    assert.equal(o.byService.reduce((s, c) => s + c.amountMinor, 0), o.receivedMinor);
    assert.deepEqual(o.byService.map((s) => s.key).sort(), ["seo", "web"], "a discount line reduces services, it isn't one");
  });

  it("outstanding = pending + overdue, from balances now", () => {
    assert.equal(o.pendingMinor, 9999 - 3333);
    assert.equal(o.overdueMinor, 5000);
    assert.equal(o.outstandingMinor, o.pendingMinor + o.overdueMinor);
    assert.deepEqual(o.counts, { pending: 1, overdue: 1, paidInRange: 1, otherCurrency: 1 });
  });

  it("the trend matches the payments and invoices month by month", () => {
    const sep = o.trend.find((t) => t.month === "2026-09")!;
    const aug = o.trend.find((t) => t.month === "2026-08")!;
    const jul = o.trend.find((t) => t.month === "2026-07")!;
    assert.equal(sep.receivedMinor, 10000);
    assert.equal(aug.receivedMinor, 3333);
    assert.equal(sep.invoicedMinor, 10000 + 9999, "sent invoices issued in September (not the draft, void or EUR one)");
    assert.equal(jul.invoicedMinor, 5000);
    assert.equal(o.trend.length, 12);
    const all = buildOverview({ currency: "USD", todayKey: "2026-09-28", range: "12m", invoices, payments });
    assert.equal(all.receivedMinor, all.trend.reduce((s, t) => s + t.receivedMinor, 0));
    assert.equal(all.invoicedMinor, all.trend.reduce((s, t) => s + t.invoicedMinor, 0));
  });
});
