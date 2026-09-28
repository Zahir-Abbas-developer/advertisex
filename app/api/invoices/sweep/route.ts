import { NextResponse } from "next/server";

import { requireApi } from "@/modules/rbac/server";
import { sweepInvoices } from "@/modules/billing/lifecycle";

/** "Check for overdue invoices now" — the morning job, on demand, within the founder's organization (tenancy-scoped). */
export async function POST() {
  const gate = await requireApi("update", "invoice");
  if (gate.response) return gate.response;
  return NextResponse.json(await sweepInvoices(new Date()));
}
