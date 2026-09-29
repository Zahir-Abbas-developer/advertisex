import { NextResponse } from "next/server";

import { apiError } from "@/lib/api";
import { appUrl } from "@/lib/email/send";
import { requireApi } from "@/modules/rbac/server";
import { balanceOf, OPEN_STATUSES, type InvoiceStatus } from "@/modules/billing/domain";
import { invoiceForClient } from "@/modules/billing/server";
import { paymentProvider } from "@/modules/integrations/payments";

/**
 * Pay online (only when live charging is switched on): a checkout for the
 * balance. The payment is recorded when the provider's signed webhook
 * arrives, never on the redirect back.
 */
export async function POST(_request: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const gate = await requireApi("read", "invoice");
  if (gate.response) return gate.response;
  const provider = paymentProvider();
  if (!provider) return apiError("Not found", 404);
  const inv = await invoiceForClient(gate.principal, params.id);
  if (!inv) return apiError("Not found", 404);
  const balance = balanceOf(inv);
  if (!OPEN_STATUSES.includes(inv.status as InvoiceStatus) || balance <= 0) return apiError("Nothing is due on this invoice", 409);
  try {
    const base = appUrl();
    const { url } = await provider.createCheckout({
      invoiceId: inv.id,
      organizationId: inv.organizationId,
      numberLabel: inv.numberLabel ?? inv.id,
      amountMinor: balance,
      currency: inv.currency,
      customerEmail: inv.billToEmail,
      successUrl: `${base}/portal/invoices/${inv.id}?paid=1`,
      cancelUrl: `${base}/portal/invoices/${inv.id}`,
    });
    return NextResponse.json({ url });
  } catch {
    return apiError("Online payment isn't available right now", 502);
  }
}
