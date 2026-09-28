import { NextResponse } from "next/server";

import { apiError } from "@/lib/api";
import { requireApi } from "@/modules/rbac/server";
import { portalReports } from "@/modules/portal/server";

/** The client's published reports, with unread flags. */
export async function GET() {
  const gate = await requireApi("read", "clientReport");
  if (gate.response) return gate.response;
  if (gate.principal.role !== "CLIENT") return apiError("Not found", 404);
  return NextResponse.json({ reports: await portalReports(gate.principal) });
}
