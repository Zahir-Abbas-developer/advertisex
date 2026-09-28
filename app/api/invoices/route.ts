import { NextResponse } from "next/server";
import { z } from "zod";

import { apiError } from "@/lib/api";
import { requireApi } from "@/modules/rbac/server";
import { billingErrorResponse, listInvoices, saveDraft } from "@/modules/billing/server";

/** The founder's invoices: `?status=` (a status, or OPEN), `?clientId=`, `?q=` (number or client), `?page=`. */
export async function GET(request: Request) {
  const gate = await requireApi("read", "invoice");
  if (gate.response) return gate.response;
  if (gate.principal.role === "CLIENT") return apiError("Not found", 404);
  const p = new URL(request.url).searchParams;
  return NextResponse.json(
    await listInvoices({ status: p.get("status") ?? undefined, clientId: p.get("clientId") ?? undefined, q: p.get("q")?.trim().slice(0, 80) || undefined, page: Number(p.get("page") ?? 1) || 1 }),
  );
}

const draftSchema = z
  .object({
    clientId: z.string().min(1, "Choose a client"),
    projectId: z.string().nullish(),
    currency: z.string().length(3),
    dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick a due date"),
    notes: z.string().max(2000).nullish(),
    lines: z
      .array(z.object({ serviceId: z.string().nullish(), description: z.string().max(300), quantity: z.string().max(20), rate: z.string().max(24) }).strict())
      .max(100),
  })
  .strict();

/** Creates a draft. Amounts arrive as text and are parsed to integer minor units. */
export async function POST(request: Request) {
  const gate = await requireApi("create", "invoice");
  if (gate.response) return gate.response;
  const parsed = draftSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return apiError("Please fix the highlighted fields", 422, Object.fromEntries(parsed.error.issues.map((i) => [i.path.join("."), i.message])));
  try {
    const invoice = await saveDraft(gate.principal, parsed.data);
    return NextResponse.json({ invoice: { id: invoice.id } }, { status: 201 });
  } catch (error) {
    return billingErrorResponse(error);
  }
}
