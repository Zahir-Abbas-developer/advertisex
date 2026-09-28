import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { parseStripeEvent, stripeSignatureHeader, verifyStripeSignature } from "../modules/integrations/payments/stripe";

const SECRET = "whsec_test_secret";
const now = new Date("2026-09-28T12:00:00Z");
const t = Math.floor(now.getTime() / 1000);
const event = (o: Record<string, unknown> = {}) =>
  JSON.stringify({
    id: "evt_1",
    type: "checkout.session.completed",
    created: t,
    data: { object: { id: "cs_1", payment_status: "paid", amount_total: 12345, currency: "usd", payment_intent: "pi_1", metadata: { invoiceId: "inv_1", organizationId: "org_1" }, ...o } },
  });

describe("Stripe webhooks", () => {
  it("accepts a correctly signed, fresh event", () => {
    const body = event();
    assert.equal(verifyStripeSignature(body, stripeSignatureHeader(body, SECRET, t), SECRET, now), true);
  });

  it("refuses a tampered body, a wrong secret, a stale timestamp, or no header", () => {
    const body = event();
    const header = stripeSignatureHeader(body, SECRET, t);
    assert.equal(verifyStripeSignature(body.replace("12345", "99999"), header, SECRET, now), false);
    assert.equal(verifyStripeSignature(body, stripeSignatureHeader(body, "whsec_other", t), SECRET, now), false);
    assert.equal(verifyStripeSignature(body, stripeSignatureHeader(body, SECRET, t - 301), SECRET, now), false, "replayed after five minutes");
    assert.equal(verifyStripeSignature(body, null, SECRET, now), false);
    assert.equal(verifyStripeSignature(body, "t=abc,v1=zz", SECRET, now), false);
  });

  it("turns a paid checkout into a payment in minor units", () => {
    const body = event();
    const r = parseStripeEvent(body, stripeSignatureHeader(body, SECRET, t), SECRET, now);
    assert.ok(r.ok && r.payment);
    assert.deepEqual({ ...r.payment, paidAt: r.payment.paidAt.toISOString() }, {
      eventId: "evt_1",
      invoiceId: "inv_1",
      organizationId: "org_1",
      amountMinor: 12345,
      currency: "USD",
      providerRef: "pi_1",
      paidAt: now.toISOString(),
    });
  });

  it("acknowledges other events without a payment", () => {
    const unpaid = event({ payment_status: "unpaid" });
    const r = parseStripeEvent(unpaid, stripeSignatureHeader(unpaid, SECRET, t), SECRET, now);
    assert.ok(r.ok && r.payment === null);
    const other = JSON.stringify({ id: "evt_2", type: "customer.created", data: { object: {} } });
    const r2 = parseStripeEvent(other, stripeSignatureHeader(other, SECRET, t), SECRET, now);
    assert.ok(r2.ok && r2.payment === null && r2.type === "customer.created");
    const bad = parseStripeEvent(unpaid, "t=1,v1=00", SECRET, now);
    assert.equal(bad.ok, false);
  });
});
