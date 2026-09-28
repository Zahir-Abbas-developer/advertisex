import { NextResponse } from "next/server";

import { apiError } from "@/lib/api";
import { requireApi } from "@/modules/rbac/server";
import { invoiceForClient } from "@/modules/billing/server";
import { portalInvoiceView } from "@/modules/billing/views";
import { onlinePaymentsEnabled } from "@/modules/integrations/payments";

/** One of the account's invoices, with its payment history. Another account's, a draft, or a member asking: 404. */
export async function GET(_request: Request, { params }: { params: { id: string } }) {
  const gate = await requireApi("read", "invoice");
  if (gate.response) return gate.response;
  const inv = await invoiceForClient(gate.principal, params.id);
  if (!inv) return apiError("Not found", 404);
  return NextResponse.json({ invoice: portalInvoiceView(inv), onlinePayments: onlinePaymentsEnabled() }, { headers: { "Cache-Control": "private, no-store" } });
}
