import { NextResponse } from "next/server";
import { z } from "zod";

import { apiError } from "@/lib/api";
import { requireApi } from "@/modules/rbac/server";
import { deleteRule, ruleInputSchema, setRuleEnabled, updateRule } from "@/modules/ai/agents/rules";
import { agentErrorResponse, issues } from "@/modules/ai/agents/http";

const toggleSchema = z.object({ enabled: z.boolean() }).strict();

/** Edit a rule (the whole rule), or just switch it on/off (`{ enabled }`). */
export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  const gate = await requireApi("update", "automation", "Only a founder can change automations");
  if (gate.response) return gate.response;
  const body = await request.json().catch(() => null);
  try {
    const toggle = toggleSchema.safeParse(body);
    if (toggle.success) {
      await setRuleEnabled(gate.principal, params.id, toggle.data.enabled);
      return NextResponse.json({ ok: true });
    }
    const parsed = ruleInputSchema.safeParse(body);
    if (!parsed.success) return apiError("Please fix the highlighted fields", 422, issues(parsed.error));
    await updateRule(gate.principal, params.id, parsed.data);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return agentErrorResponse(error);
  }
}

export async function DELETE(_request: Request, { params }: { params: { id: string } }) {
  const gate = await requireApi("delete", "automation", "Only a founder can delete automations");
  if (gate.response) return gate.response;
  try {
    await deleteRule(gate.principal, params.id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return agentErrorResponse(error);
  }
}
