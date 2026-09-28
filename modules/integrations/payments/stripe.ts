import { createHmac, timingSafeEqual } from "node:crypto";

import type { CheckoutInput, PaymentProvider, WebhookResult } from "@/modules/integrations/payments/provider";

/**
 * Stripe, over its REST API with `fetch` (no SDK). Checkout Sessions take the
 * balance; `checkout.session.completed` with `payment_status: paid` is the
 * one event that records a payment. Everything else is acknowledged and
 * ignored.
 */

const TOLERANCE_SECONDS = 300;

/**
 * Stripe's signature scheme: header `t=<unix>,v1=<hex>[,v1=…]`, where v1 is
 * HMAC-SHA256(secret, `${t}.${rawBody}`). Constant-time compare, and the
 * timestamp must be within five minutes (replay protection).
 */
export function verifyStripeSignature(rawBody: string, header: string | null, secret: string, now = new Date()): boolean {
  if (!header || !secret) return false;
  const parts = header.split(",").map((p) => p.trim().split("="));
  const t = parts.find(([k]) => k === "t")?.[1];
  const sigs = parts.filter(([k]) => k === "v1").map(([, v]) => v ?? "");
  if (!t || !/^\d+$/.test(t) || sigs.length === 0) return false;
  if (Math.abs(Math.floor(now.getTime() / 1000) - Number(t)) > TOLERANCE_SECONDS) return false;
  const expected = createHmac("sha256", secret).update(`${t}.${rawBody}`).digest();
  return sigs.some((s) => {
    if (!/^[0-9a-f]+$/i.test(s)) return false;
    const given = Buffer.from(s, "hex");
    return given.length === expected.length && timingSafeEqual(given, expected);
  });
}

/** The header a test (or Stripe) would send for `rawBody` at `t`. */
export function stripeSignatureHeader(rawBody: string, secret: string, t = Math.floor(Date.now() / 1000)): string {
  return `t=${t},v1=${createHmac("sha256", secret).update(`${t}.${rawBody}`).digest("hex")}`;
}

type StripeSession = {
  id?: string;
  payment_status?: string;
  amount_total?: number;
  currency?: string;
  payment_intent?: string | null;
  metadata?: Record<string, string>;
  created?: number;
};

export function parseStripeEvent(rawBody: string, header: string | null, secret: string, now = new Date()): WebhookResult {
  if (!verifyStripeSignature(rawBody, header, secret, now)) return { ok: false, reason: "bad signature" };
  let event: { id?: string; type?: string; created?: number; data?: { object?: StripeSession } };
  try {
    event = JSON.parse(rawBody);
  } catch {
    return { ok: false, reason: "bad JSON" };
  }
  const type = event.type ?? "unknown";
  const s = event.data?.object;
  if (type !== "checkout.session.completed" || !s || s.payment_status !== "paid") return { ok: true, type, payment: null };
  const invoiceId = s.metadata?.invoiceId;
  const organizationId = s.metadata?.organizationId;
  if (!event.id || !invoiceId || !organizationId || !Number.isSafeInteger(s.amount_total) || !s.currency) return { ok: false, reason: "incomplete event" };
  return {
    ok: true,
    type,
    payment: {
      eventId: event.id,
      invoiceId,
      organizationId,
      amountMinor: s.amount_total!,
      currency: s.currency.toUpperCase(),
      providerRef: s.payment_intent ?? s.id ?? null,
      paidAt: new Date((event.created ?? Math.floor(now.getTime() / 1000)) * 1000),
    },
  };
}

export function stripeProvider(config: { secretKey: string; webhookSecret: string }): PaymentProvider {
  return {
    id: "stripe",
    async createCheckout(input: CheckoutInput) {
      const form = new URLSearchParams({
        mode: "payment",
        success_url: input.successUrl,
        cancel_url: input.cancelUrl,
        client_reference_id: input.invoiceId,
        "line_items[0][quantity]": "1",
        "line_items[0][price_data][currency]": input.currency.toLowerCase(),
        "line_items[0][price_data][unit_amount]": String(input.amountMinor),
        "line_items[0][price_data][product_data][name]": `Invoice ${input.numberLabel}`,
        "metadata[invoiceId]": input.invoiceId,
        "metadata[organizationId]": input.organizationId,
      });
      if (input.customerEmail) form.set("customer_email", input.customerEmail);
      const res = await fetch("https://api.stripe.com/v1/checkout/sessions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${config.secretKey}`,
          "Content-Type": "application/x-www-form-urlencoded",
          // One session per invoice balance: a double click can't open two.
          "Idempotency-Key": `checkout:${input.invoiceId}:${input.amountMinor}`,
        },
        body: form,
        signal: AbortSignal.timeout(10_000),
      });
      const body = (await res.json().catch(() => ({}))) as { id?: string; url?: string; error?: { message?: string } };
      if (!res.ok || !body.url || !body.id) throw new Error(`Stripe checkout failed: ${res.status} ${body.error?.message ?? ""}`.trim());
      return { url: body.url, sessionId: body.id };
    },
    parseWebhook(rawBody: string, headers: Headers, now?: Date) {
      return parseStripeEvent(rawBody, headers.get("stripe-signature"), config.webhookSecret, now);
    },
  };
}
