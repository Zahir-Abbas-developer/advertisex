import { NextResponse } from "next/server";
import { z } from "zod";

import { apiError } from "@/lib/api";
import { requireApi } from "@/modules/rbac/server";
import { listRuns, startRun } from "@/modules/ai/agents/server";
import { agentErrorResponse, issues } from "@/modules/ai/agents/http";

/** Runs the caller may see: `?agentId=`, `?status=`, `?page=`. */
export async function GET(request: Request) {
  const gate = await requireApi("read", "agent");
  if (gate.response) return gate.response;
  const p = new URL(request.url).searchParams;
  return NextResponse.json(await listRuns(gate.principal, { agentId: p.get("agentId") ?? undefined, status: p.get("status") ?? undefined, page: Number(p.get("page") ?? 1) || 1 }));
}

const schema = z
  .object({
    agentId: z.string().min(1, "Pick an AI employee"),
    subjectType: z.enum(["lead", "client", "project", "organization"]),
    subjectId: z.string().min(1).nullable(),
    brief: z.string().trim().max(2000).nullish(),
  })
  .strict();

/** Give an AI employee work. It runs in the background; the response is the queued run. */
export async function POST(request: Request) {
  const gate = await requireApi("create", "agent", "You can't give AI employees work");
  if (gate.response) return gate.response;
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return apiError("Please fix the highlighted fields", 422, issues(parsed.error));
  try {
    const run = await startRun(gate.principal, parsed.data);
    return NextResponse.json({ run: { id: run.id, status: run.status } }, { status: 202 });
  } catch (error) {
    return agentErrorResponse(error);
  }
}

export const dynamic = "force-dynamic";
