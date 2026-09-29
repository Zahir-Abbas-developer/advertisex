import { prisma } from "@/lib/prisma";
import type { SubjectType } from "@/modules/ai/agents/capability";
import { capability as findCapability } from "@/modules/ai/agents/registry";

/**
 * The agent queue (Phase 9): putting work on it, nothing more. Kept apart
 * from the runner so the code that emits events — lead creation, stage
 * moves, the morning sweep, the monthly report job — can queue work without
 * loading the executor (its tools reach back into those same modules). The
 * worker is loaded on demand.
 */

export class RunError extends Error {
  constructor(
    message: string,
    public status = 422,
  ) {
    super(message);
  }
}

export async function enqueueRun(input: { organizationId: string; agentId: string; subjectType: SubjectType; subjectId: string | null; input?: Record<string, unknown>; requestedById?: string | null; ruleId?: string | null }) {
  const profile = await prisma.agentProfile.findUnique({ where: { userId: input.agentId }, include: { user: { select: { organizationId: true, isActive: true } } } });
  if (!profile || profile.user.organizationId !== input.organizationId) throw new RunError("That agent doesn't exist here", 404);
  const cap = findCapability(profile.capability);
  if (!cap) throw new RunError(`Unknown capability "${profile.capability}"`);
  if (cap.subjectType !== input.subjectType) throw new RunError(`${cap.name} works on a ${cap.subjectType}, not a ${input.subjectType}`);
  if (!profile.enabled || !profile.user.isActive) throw new RunError(`${cap.name} is paused`, 409);
  const departmentId = await subjectDepartment(input.organizationId, input.subjectType, input.subjectId);
  if (input.subjectType !== "organization" && !departmentId) throw new RunError(`That ${input.subjectType} doesn't exist here`, 404);
  const run = await prisma.agentRun.create({
    data: { organizationId: input.organizationId, agentId: input.agentId, capability: cap.key, subjectType: input.subjectType, subjectId: input.subjectId, departmentId, input: JSON.stringify({ ...(input.input ?? {}), requestedById: input.requestedById ?? null }), requestedById: input.requestedById ?? null, ruleId: input.ruleId ?? null },
  });
  kick();
  return run;
}

/** The department a subject belongs to, within this organization — or null. */
export async function subjectDepartment(organizationId: string, subjectType: SubjectType, subjectId: string | null): Promise<string | null> {
  if (!subjectId || subjectType === "organization") return null;
  if (subjectType === "lead") return (await prisma.lead.findFirst({ where: { id: subjectId, department: { organizationId } }, select: { departmentId: true } }))?.departmentId ?? null;
  if (subjectType === "client") return (await prisma.client.findFirst({ where: { id: subjectId, organizationId }, select: { departmentId: true } }))?.departmentId ?? null;
  return (await prisma.project.findFirst({ where: { id: subjectId, organizationId }, select: { client: { select: { departmentId: true } } } }))?.client.departmentId ?? null;
}

/**
 * Starts the in-process worker (never awaited by callers). `AGENT_WORKER=off`
 * leaves queued work to the cron worker — for processes, like the test
 * harnesses, that queue work but must not run it.
 */
export function kick() {
  if (process.env.AGENT_WORKER === "off") return;
  import("@/modules/ai/agents/runner").then((r) => r.startWorker()).catch((error) => console.error("agent worker failed to start", error));
}
