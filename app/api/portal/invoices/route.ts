import { NextResponse } from "next/server";

import { apiError } from "@/lib/api";
import { requireApi } from "@/modules/rbac/server";
import { accountOf, isOwner, portalPlan } from "@/modules/portal/server";
import { invoicesForAccount } from "@/modules/billing/portal";

/** Invoices (Phase 7 fills them) and the agreed plan — the account owner's view. */
export async function GET() {
  const gate = await requireApi("read", "clientAccount");
  if (gate.response) return gate.response;
  if (gate.principal.role !== "CLIENT") return apiError("Not found", 404);
  if (!(await isOwner(gate.principal))) return apiError("Billing is visible to your account's owner", 403);
  return NextResponse.json({ invoices: await invoicesForAccount(accountOf(gate.principal)), plan: await portalPlan(gate.principal) });
}
