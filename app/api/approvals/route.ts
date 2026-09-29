import { NextResponse } from "next/server";

import { requireApi } from "@/modules/rbac/server";
import { listApprovals } from "@/modules/ai/agents/server";

/** The review queue: `?status=PENDING` (default) or `DECIDED`. Founders: all; managers: their departments'. */
export async function GET(request: Request) {
  const gate = await requireApi("read", "approval");
  if (gate.response) return gate.response;
  const status = new URL(request.url).searchParams.get("status") === "DECIDED" ? "DECIDED" : "PENDING";
  return NextResponse.json({ approvals: await listApprovals(gate.principal, status) });
}

export const dynamic = "force-dynamic";
