import { NextResponse } from "next/server";
import { z } from "zod";

import { apiError } from "@/lib/api";
import { requireApi } from "@/modules/rbac/server";
import { PAYMENT_METHODS } from "@/modules/billing/domain";
import { parseMoney } from "@/modules/billing/money";
import { billingErrorResponse, invoiceForStaff, keyToDate, todayKey } from "@/modules/billing/server";
import { recordPayment } from "@/modules/billing/lifecycle";

const schema = z
  .object({
    amount: z.string().max(24),
    method: z.enum(PAYMENT_METHODS),
    paidAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick the date it arrived"),
    reference: z.string().max(120).nullish(),
    idempotencyKey: z.string().min(8).max(100).optional(),
  })
  .strict();

/**
 * Records a payment. Idempotent: send the same `Idempotency-Key` header (or
 * `idempotencyKey`) again and the payment is recorded once — the repeat
 * answers 200 with the original instead of 201.
 */
export async function POST(request: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const gate = await requireApi("create", "payment");
  if (gate.response) return gate.response;
  const inv = await invoiceForStaff(gate.principal, params.id, "update");
  if (!inv) return apiError("Not found", 404);
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return apiError("Please fix the highlighted fields", 422, Object.fromEntries(parsed.error.issues.map((i) => [String(i.path[0]), i.message])));
  const key = request.headers.get("idempotency-key") ?? parsed.data.idempotencyKey;
  if (!key || key.length < 8 || key.length > 100) return apiError("An idempotency key is required", 400);
  const amount = parseMoney(parsed.data.amount);
  if (!amount.ok) return apiError(amount.error, 422, { amount: amount.error });
  if (parsed.data.paidAt > (await todayKey())) return apiError("A payment can't arrive in the future", 422, { paidAt: "Today or earlier" });
  try {
    const result = await recordPayment(
      inv.id,
      inv.organizationId,
      { amountMinor: amount.value, method: parsed.data.method, paidAt: keyToDate(parsed.data.paidAt), reference: parsed.data.reference, idempotencyKey: `manual:${key}` },
      gate.principal.id,
    );
    return NextResponse.json({ payment: { id: result.payment.id }, replayed: result.replayed }, { status: result.replayed ? 200 : 201 });
  } catch (error) {
    return billingErrorResponse(error);
  }
}
