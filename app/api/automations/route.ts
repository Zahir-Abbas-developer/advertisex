import { NextResponse } from "next/server";

import { apiError } from "@/lib/api";
import { requireApi } from "@/modules/rbac/server";
import { createRule, listRules, ruleInputSchema } from "@/modules/ai/agents/rules";
import { agentErrorResponse, issues } from "@/modules/ai/agents/http";

/** The founder's automation rules. */
export async function GET() {
  const gate = await requireApi("read", "automation");
  if (gate.response) return gate.response;
  return NextResponse.json({ rules: await listRules(gate.principal) });
}

export async function POST(request: Request) {
  const gate = await requireApi("create", "automation", "Only a founder can create automations");
  if (gate.response) return gate.response;
  const parsed = ruleInputSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return apiError("Please fix the highlighted fields", 422, issues(parsed.error));
  try {
    const rule = await createRule(gate.principal, parsed.data);
    return NextResponse.json({ rule: { id: rule.id } }, { status: 201 });
  } catch (error) {
    return agentErrorResponse(error);
  }
}

export const dynamic = "force-dynamic";
