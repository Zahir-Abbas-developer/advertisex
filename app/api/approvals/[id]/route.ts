import { NextResponse } from "next/server";
import { z } from "zod";

import { apiError } from "@/lib/api";
import { requireApi } from "@/modules/rbac/server";
import { decide } from "@/modules/ai/agents/approvals";
import { agentErrorResponse, issues } from "@/modules/ai/agents/http";

const schema = z.object({ decision: z.enum(["APPROVED", "REJECTED"]), note: z.string().trim().max(500).nullish() }).strict();

/** Approve (which carries the action out, as the approver) or reject. Decided once. */
export async function POST(request: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const gate = await requireApi("update", "approval", "You can't decide agent proposals");
  if (gate.response) return gate.response;
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return apiError("Please fix the highlighted fields", 422, issues(parsed.error));
  try {
    return NextResponse.json(await decide(gate.principal, params.id, parsed.data.decision, parsed.data.note ?? null));
  } catch (error) {
    return agentErrorResponse(error);
  }
}
