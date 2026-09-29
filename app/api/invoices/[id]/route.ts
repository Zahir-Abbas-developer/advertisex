import { NextResponse } from "next/server";
import { z } from "zod";

import { apiError } from "@/lib/api";
import { requireApi } from "@/modules/rbac/server";
import { billingErrorResponse, deleteDraft, invoiceForStaff, saveDraft } from "@/modules/billing/server";
import { staffInvoiceView } from "@/modules/billing/views";
import { onlinePaymentsEnabled } from "@/modules/integrations/payments";

/** One invoice, with its lines and full payment history (reversals included). */
export async function GET(_request: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const gate = await requireApi("read", "invoice");
  if (gate.response) return gate.response;
  const inv = await invoiceForStaff(gate.principal, params.id);
  if (!inv) return apiError("Not found", 404);
  return NextResponse.json({ invoice: staffInvoiceView(inv), onlinePayments: onlinePaymentsEnabled() }, { headers: { "Cache-Control": "private, no-store" } });
}

const schema = z
  .object({
    clientId: z.string().min(1),
    projectId: z.string().nullish(),
    currency: z.string().length(3),
    dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick a due date"),
    notes: z.string().max(2000).nullish(),
    lines: z.array(z.object({ serviceId: z.string().nullish(), description: z.string().max(300), quantity: z.string().max(20), rate: z.string().max(24) }).strict()).max(100),
  })
  .strict();

/** Replaces a draft's contents. A sent invoice can't be edited (void and reissue). */
export async function PATCH(request: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const gate = await requireApi("update", "invoice");
  if (gate.response) return gate.response;
  if (!(await invoiceForStaff(gate.principal, params.id, "update"))) return apiError("Not found", 404);
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return apiError("Please fix the highlighted fields", 422, Object.fromEntries(parsed.error.issues.map((i) => [i.path.join("."), i.message])));
  try {
    await saveDraft(gate.principal, parsed.data, params.id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return billingErrorResponse(error);
  }
}

export async function DELETE(_request: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const gate = await requireApi("delete", "invoice");
  if (gate.response) return gate.response;
  if (!(await invoiceForStaff(gate.principal, params.id, "update"))) return apiError("Not found", 404);
  try {
    await deleteDraft(params.id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return billingErrorResponse(error);
  }
}
