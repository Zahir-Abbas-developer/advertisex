import { NextResponse } from "next/server";

import { apiError } from "@/lib/api";
import { requireApi } from "@/modules/rbac/server";
import { receivables } from "@/modules/analytics/server";

/** Outstanding payments by age. Money: the founder's. */
export async function GET() {
  const gate = await requireApi("read", "finance");
  if (gate.response) return gate.response;
  if (!gate.principal.organizationId) return apiError("Not found", 404);
  return NextResponse.json({ receivables: await receivables(gate.principal.organizationId) }, { headers: { "Cache-Control": "private, no-store" } });
}
