import { NextResponse } from "next/server";

import { apiError } from "@/lib/api";
import { requireApi } from "@/modules/rbac/server";
import { RANGES, type Range } from "@/modules/billing/domain";
import { financialOverview } from "@/modules/billing/overview";

/** The founder's financial overview for `?range=` (month · quarter · year · 12m). Formulas: docs/METRICS.md. */
export async function GET(request: Request) {
  const gate = await requireApi("read", "finance");
  if (gate.response) return gate.response;
  if (!gate.principal.organizationId) return apiError("Not found", 404);
  const raw = new URL(request.url).searchParams.get("range") ?? "month";
  const range: Range = (RANGES as readonly string[]).includes(raw) ? (raw as Range) : "month";
  return NextResponse.json({ overview: await financialOverview(gate.principal.organizationId, range) }, { headers: { "Cache-Control": "private, no-store" } });
}
