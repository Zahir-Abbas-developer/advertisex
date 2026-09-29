import { NextResponse } from "next/server";

import { apiError } from "@/lib/api";
import { requireApi } from "@/modules/rbac/server";
import { portalReportView } from "@/modules/portal/server";

/** A published monthly report, in-app, for its own account (marks it read). Anyone else's, or a draft: 404. */
export async function GET(_request: Request, { params }: { params: { id: string } }) {
  const gate = await requireApi("read", "clientReport");
  if (gate.response) return gate.response;
  if (gate.principal.role !== "CLIENT") return apiError("Not found", 404);
  const report = await portalReportView(gate.principal, params.id);
  if (!report) return apiError("Not found", 404);
  return NextResponse.json({ report }, { headers: { "Cache-Control": "private, no-store" } });
}
