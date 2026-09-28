import { NextResponse } from "next/server";
import { z } from "zod";

import { prisma } from "@/lib/prisma";
import { apiError } from "@/lib/api";
import { requireApi } from "@/modules/rbac/server";
import { CURRENCY_CODES } from "@/modules/billing/money";

/** The organization's billing details: what invoices print and default to. */
export async function GET() {
  const gate = await requireApi("read", "admin");
  if (gate.response) return gate.response;
  if (!gate.principal.organizationId) return apiError("Not found", 404);
  const org = await prisma.organization.findUniqueOrThrow({
    where: { id: gate.principal.organizationId },
    select: { name: true, invoicePrefix: true, nextInvoiceNumber: true, currency: true, paymentTermsDays: true, billingAddress: true, billingEmail: true },
  });
  return NextResponse.json({ billing: org, currencies: CURRENCY_CODES });
}

const schema = z
  .object({
    invoicePrefix: z.string().trim().regex(/^[A-Z0-9]{1,8}$/, "1–8 capital letters or digits"),
    currency: z.enum(CURRENCY_CODES as [string, ...string[]]),
    paymentTermsDays: z.number().int().min(0, "0 or more").max(120, "At most 120 days"),
    billingAddress: z.string().trim().max(300).nullable(),
    billingEmail: z.string().trim().email("A valid email").max(160).nullable().or(z.literal("").transform(() => null)),
  })
  .strict();

/**
 * Updates them. The next number is not editable: it is the sequence, and a
 * gap or a repeat is exactly what numbering must never have. The prefix
 * changes only invoices sent from now on — issued numbers are frozen.
 */
export async function PATCH(request: Request) {
  const gate = await requireApi("update", "admin");
  if (gate.response) return gate.response;
  if (!gate.principal.organizationId) return apiError("Not found", 404);
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return apiError("Please fix the highlighted fields", 422, Object.fromEntries(parsed.error.issues.map((i) => [String(i.path[0]), i.message])));
  await prisma.organization.update({ where: { id: gate.principal.organizationId }, data: { ...parsed.data, billingAddress: parsed.data.billingAddress || null } });
  return NextResponse.json({ ok: true });
}
