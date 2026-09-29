import { NextResponse } from "next/server";
import { z } from "zod";

import { apiError } from "@/lib/api";
import { requireApi } from "@/modules/rbac/server";
import { updateAgent } from "@/modules/ai/agents/server";
import { agentErrorResponse, issues } from "@/modules/ai/agents/http";

const schema = z
  .object({
    capability: z.string().min(1).optional(),
    enabled: z.boolean().optional(),
    maxRunsPerHour: z.number().int().min(1).max(500).optional(),
    /** Whole micro-dollars; the UI sends dollars × 1,000,000. Up to $1,000 a month. */
    monthlyBudgetMicros: z.number().int().min(0).max(1_000_000_000).optional(),
  })
  .strict();

/** Assign a capability (adding the grants it needs), pause, or set limits. Founder only. */
export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  const gate = await requireApi("update", "agent", "Only a founder can change an AI employee");
  if (gate.response) return gate.response;
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return apiError("Please fix the highlighted fields", 422, issues(parsed.error));
  try {
    const out = await updateAgent(gate.principal, params.id, parsed.data);
    return NextResponse.json({ ok: true, grantsAdded: out.grantsAdded });
  } catch (error) {
    return agentErrorResponse(error);
  }
}
