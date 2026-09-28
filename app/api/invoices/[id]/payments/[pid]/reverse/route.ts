import { NextResponse } from "next/server";
import { z } from "zod";

import { apiError } from "@/lib/api";
import { requireApi } from "@/modules/rbac/server";
import { billingErrorResponse, invoiceForStaff } from "@/modules/billing/server";
import { reversePayment } from "@/modules/billing/lifecycle";

const schema = z.object({ reason: z.string().trim().min(3, "Say why").max(300) }).strict();

/** Reverses a payment recorded in error. It stays in the history, marked reversed, with who and why. */
export async function POST(request: Request, { params }: { params: { id: string; pid: string } }) {
  const gate = await requireApi("update", "payment");
  if (gate.response) return gate.response;
  if (!(await invoiceForStaff(gate.principal, params.id, "update"))) return apiError("Not found", 404);
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return apiError("Say why it's being reversed", 422, { reason: parsed.error.issues[0]?.message ?? "Say why" });
  try {
    await reversePayment(params.id, params.pid, parsed.data.reason, gate.principal.id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return billingErrorResponse(error);
  }
}
