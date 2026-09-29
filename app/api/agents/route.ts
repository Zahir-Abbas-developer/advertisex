import { NextResponse } from "next/server";
import { z } from "zod";

import { apiError } from "@/lib/api";
import { requireApi } from "@/modules/rbac/server";
import { capabilityCatalog, hireAgent, listAgents } from "@/modules/ai/agents/server";
import { agentErrorResponse, issues } from "@/modules/ai/agents/http";

/** The AI employees, with their capability, limits and performance. Everyone on staff. */
export async function GET() {
  const gate = await requireApi("read", "agent");
  if (gate.response) return gate.response;
  return NextResponse.json({ agents: await listAgents(gate.principal), capabilities: capabilityCatalog() });
}

const hireSchema = z.object({ name: z.string().trim().min(1, "Name them").max(40), jobTitle: z.string().trim().max(60).nullish(), capability: z.string().min(1, "Pick a capability") }).strict();

/** Hire an AI employee: founder only. It gets the grants its capability needs, recorded as the founder's. */
export async function POST(request: Request) {
  const gate = await requireApi("update", "agent", "Only a founder can hire AI employees");
  if (gate.response) return gate.response;
  const parsed = hireSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return apiError("Please fix the highlighted fields", 422, issues(parsed.error));
  try {
    const agent = await hireAgent(gate.principal, parsed.data);
    return NextResponse.json({ agent: { id: agent.id } }, { status: 201 });
  } catch (error) {
    return agentErrorResponse(error);
  }
}

export const dynamic = "force-dynamic";
