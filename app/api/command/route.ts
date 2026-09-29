import { NextResponse } from "next/server";

import { apiError } from "@/lib/api";
import { requireApi } from "@/modules/rbac/server";
import { PERIODS, type Period } from "@/modules/analytics/domain";
import { commandCenter } from "@/modules/analytics/server";

/** The founder Command Center for `?period=` (7d · 30d · 90d · month · quarter · year), with the comparison period. */
export async function GET(request: Request) {
  const gate = await requireApi("read", "command");
  if (gate.response) return gate.response;
  if (!gate.principal.organizationId) return apiError("Not found", 404);
  const raw = new URL(request.url).searchParams.get("period") ?? "30d";
  const period: Period = (PERIODS as readonly string[]).includes(raw) ? (raw as Period) : "30d";
  return NextResponse.json({ command: await commandCenter(gate.principal, period) }, { headers: { "Cache-Control": "private, no-store" } });
}
