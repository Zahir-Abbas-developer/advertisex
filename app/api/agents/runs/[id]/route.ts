import { NextResponse } from "next/server";

import { apiError } from "@/lib/api";
import { requireApi } from "@/modules/rbac/server";
import { runDetail } from "@/modules/ai/agents/server";

/** One run's full log: every step, its approvals, usage. A run outside the caller's scope is a 404. */
export async function GET(_request: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const gate = await requireApi("read", "agent");
  if (gate.response) return gate.response;
  const run = await runDetail(gate.principal, params.id);
  if (!run) return apiError("Not found", 404);
  return NextResponse.json({ run });
}

export const dynamic = "force-dynamic";
