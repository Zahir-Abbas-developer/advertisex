import { NextResponse } from "next/server";

import { apiError } from "@/lib/api";
import { requireApi } from "@/modules/rbac/server";
import { billingErrorResponse, invoiceForStaff, loadFullInvoice } from "@/modules/billing/server";
import { issueInvoice, notifyInvoiceSent } from "@/modules/billing/lifecycle";
import { emailInvoice } from "@/modules/billing/email";

/**
 * Sends an invoice. A draft is issued first (numbered, dated, frozen) and
 * the client's owners are told in the portal; a sent one is simply emailed
 * again. The email carries the PDF; without SMTP the invoice is still sent.
 */
export async function POST(_request: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const gate = await requireApi("update", "invoice");
  if (gate.response) return gate.response;
  const current = await invoiceForStaff(gate.principal, params.id, "update");
  if (!current) return apiError("Not found", 404);
  if (current.status === "VOID") return apiError("A void invoice can't be sent", 409);
  let issued = false;
  try {
    if (current.status === "DRAFT") {
      const inv = await issueInvoice(current.id);
      await notifyInvoiceSent(inv);
      issued = true;
    }
  } catch (error) {
    return billingErrorResponse(error);
  }
  const fresh = await loadFullInvoice(current.id);
  const emailed = fresh ? await emailInvoice(fresh) : false;
  return NextResponse.json({ issued, emailed, numberLabel: fresh?.numberLabel ?? null });
}
