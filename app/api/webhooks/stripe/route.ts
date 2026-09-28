import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { apiError } from "@/lib/api";
import { notify } from "@/lib/notifications";
import { paymentProvider } from "@/modules/integrations/payments";
import { BillingError, founderIds } from "@/modules/billing/server";
import { recordPayment } from "@/modules/billing/lifecycle";
import { formatMoney } from "@/modules/billing/money";

/**
 * Stripe's webhook (public: the signature is the credential). Off — 404 —
 * unless live charging is enabled. A verified paid checkout is recorded as
 * a payment keyed by the event id, so Stripe's retries record it once. There
 * is no session here, so every lookup names the organization explicitly.
 */
export async function POST(request: Request) {
  const provider = paymentProvider();
  if (!provider) return apiError("Not found", 404);
  const raw = await request.text();
  if (raw.length > 256_000) return apiError("Too large", 413);
  const result = provider.parseWebhook(raw, request.headers);
  if (!result.ok) return apiError("Invalid signature", 400);
  const p = result.payment;
  if (!p) return NextResponse.json({ received: true, type: result.type });

  const inv = await prisma.invoice.findFirst({ where: { id: p.invoiceId, organizationId: p.organizationId }, select: { id: true, currency: true, numberLabel: true, organizationId: true } });
  if (!inv) return NextResponse.json({ received: true, applied: false, reason: "unknown invoice" });
  try {
    if (inv.currency !== p.currency) throw new BillingError("Currency mismatch", 422);
    const out = await recordPayment(inv.id, inv.organizationId, { amountMinor: p.amountMinor, method: "CARD", paidAt: p.paidAt, idempotencyKey: `stripe:${p.eventId}`, source: "STRIPE", providerRef: p.providerRef }, null);
    return NextResponse.json({ received: true, applied: true, replayed: out.replayed });
  } catch (error) {
    if (!(error instanceof BillingError)) throw error;
    // Money arrived but can't be applied automatically (already paid, a
    // currency mismatch…): acknowledge so Stripe stops retrying, and tell the
    // founders to reconcile it by hand.
    for (const userId of await founderIds(inv.organizationId)) {
      await notify({
        userId,
        type: "PAYMENT_RECEIVED",
        title: `Online payment needs a look: ${inv.numberLabel}`,
        body: `${formatMoney(p.amountMinor, p.currency)} arrived but couldn't be applied (${error.message}).`,
        href: `/invoices/${inv.id}`,
        dedupeKey: `stripe-unapplied:${p.eventId}:${userId}`,
      });
    }
    return NextResponse.json({ received: true, applied: false, reason: error.message });
  }
}
