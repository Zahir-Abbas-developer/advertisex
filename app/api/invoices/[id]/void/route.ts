import { NextResponse } from "next/server";
import { z } from "zod";

import { apiError } from "@/lib/api";
import { requireApi } from "@/modules/rbac/server";
import { billingErrorResponse, invoiceForStaff } from "@/modules/billing/server";
import { voidInvoice } from "@/modules/billing/lifecycle";

const schema = z.object({ reason: z.string().trim().min(3, "Say why").max(300) }).strict();

/** Voids a sent invoice with no payments. It keeps its number; the sequence has no gaps. */
export async function POST(request: Request, { params }: { params: { id: string } }) {
  const gate = await requireApi("update", "invoice");
  if (gate.response) return gate.response;
  if (!(await invoiceForStaff(gate.principal, params.id, "update"))) return apiError("Not found", 404);
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return apiError("Say why it's being voided", 422, { reason: parsed.error.issues[0]?.message ?? "Say why" });
  try {
    await voidInvoice(params.id, parsed.data.reason);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return billingErrorResponse(error);
  }
}
