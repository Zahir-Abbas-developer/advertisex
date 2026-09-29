import { NextResponse } from "next/server";

import { apiError } from "@/lib/api";
import { requireApi } from "@/modules/rbac/server";
import { PERIODS, type Period } from "@/modules/analytics/domain";
import { retention } from "@/modules/analytics/server";

/** Client retention for `?period=`. */
export async function GET(request: Request) {
  const gate = await requireApi("read", "command");
  if (gate.response) return gate.response;
  if (!gate.principal.organizationId) return apiError("Not found", 404);
  const raw = new URL(request.url).searchParams.get("period") ?? "quarter";
  const period: Period = (PERIODS as readonly string[]).includes(raw) ? (raw as Period) : "quarter";
  return NextResponse.json({ retention: await retention(gate.principal.organizationId, period) }, { headers: { "Cache-Control": "private, no-store" } });
}
