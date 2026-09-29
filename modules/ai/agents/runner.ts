import "server-only";

import { prisma } from "@/lib/prisma";
import { notify } from "@/lib/notifications";
import { aiProvider } from "@/modules/ai";
import { costMicros, formatMicros } from "@/modules/ai/pricing";
import { principalFor } from "@/modules/rbac/server";
import { actingAs, asSystem } from "@/modules/tenancy/context";
import type { AiAsk, Capability, RunContext, SubjectType } from "@/modules/ai/agents/capability";
import { capability as findCapability } from "@/modules/ai/agents/registry";
import { forModel, stripSecrets } from "@/modules/ai/agents/safety";
import { TOOLS, ToolError, type ToolEnv, type ToolName, type Tools } from "@/modules/ai/agents/tools";

/**
 * The agent runner (Phase 9 scope 1): runs are background jobs. A run is
 * queued as a row; a worker claims it (a lease, so no two workers run it),
 * checks the agent's rate limit and budget, and executes the capability *as
 * the agent* — the data layer scopes every query to the agent's organization
 * and attributes every write to it. Each tool call is a step (inputs,
 * outputs, time) and an AGENT_ACTION audit entry; each model call adds its
 * tokens and cost to the run.
 *
 * Workers: in-process right after enqueueing (so work starts at once), the
 * morning job, and /api/cron/agents for a scheduler to call more often.
 */

const LEASE_MS = 10 * 60_000;
const MAX_ATTEMPTS = 3;

export { RunError, enqueueRun, subjectDepartment } from "@/modules/ai/agents/queue";

let draining: Promise<unknown> | null = null;

/** The in-process worker: drains the queue unless it's already draining. */
export function startWorker() {
  if (draining) return;
  draining = asSystem(() => drainQueue()).catch((error) => console.error("agent worker failed", error)).finally(() => {
    draining = null;
  });
}

/** Claims and runs queued work until none is due (or `limit` runs). */
export async function drainQueue(limit = 25, now = () => new Date()) {
  // Runs whose worker died mid-run are retried (or failed after three tries).
  const stale = new Date(now().getTime() - LEASE_MS);
  await prisma.agentRun.updateMany({ where: { status: "RUNNING", lockedAt: { lt: stale }, attempts: { lt: MAX_ATTEMPTS } }, data: { status: "QUEUED", lockedAt: null } });
  await prisma.agentRun.updateMany({ where: { status: "RUNNING", lockedAt: { lt: stale }, attempts: { gte: MAX_ATTEMPTS } }, data: { status: "FAILED", error: "The run stopped responding", finishedAt: now() } });

  let done = 0;
  while (done < limit) {
    const next = await prisma.agentRun.findFirst({ where: { status: "QUEUED", availableAt: { lte: now() } }, orderBy: { createdAt: "asc" }, select: { id: true } });
    if (!next) break;
    const claimed = await prisma.agentRun.updateMany({ where: { id: next.id, status: "QUEUED" }, data: { status: "RUNNING", lockedAt: now(), attempts: { increment: 1 } } });
    if (claimed.count !== 1) continue; // another worker took it
    await executeRun(next.id);
    done += 1;
  }
  return { ran: done };
}

const monthStart = () => {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
};

/** Spend this calendar month, in micro-dollars. */
export async function spentThisMonth(agentId: string) {
  const r = await prisma.agentRun.aggregate({ where: { agentId, createdAt: { gte: monthStart() } }, _sum: { costMicros: true } });
  return r._sum.costMicros ?? 0;
}

async function executeRun(runId: string) {
  const run = await prisma.agentRun.findUniqueOrThrow({ where: { id: runId } });
  const agent = await prisma.user.findUniqueOrThrow({ where: { id: run.agentId }, select: { id: true, name: true, organizationId: true, agentProfile: true } });
  const fail = async (message: string) => prisma.agentRun.update({ where: { id: run.id }, data: { status: "FAILED", error: stripSecrets(message).slice(0, 500), finishedAt: new Date(), lockedAt: null } });
  const cap = findCapability(run.capability);
  if (!cap || !agent.agentProfile) return fail("This agent has no capability");
  if (!agent.agentProfile.enabled) return fail(`${cap.name} is paused`);

  // Rate limit: a rolling hour. Over it, the run waits for the next free slot.
  const hourAgo = new Date(Date.now() - 3_600_000);
  const recent = await prisma.agentRun.findMany({ where: { agentId: agent.id, startedAt: { gte: hourAgo }, id: { not: run.id } }, orderBy: { startedAt: "asc" }, select: { startedAt: true } });
  if (recent.length >= agent.agentProfile.maxRunsPerHour) {
    const freeAt = new Date(recent[0].startedAt!.getTime() + 3_600_000);
    await prisma.agentRun.update({ where: { id: run.id }, data: { status: "QUEUED", availableAt: freeAt, lockedAt: null, attempts: { decrement: 1 } } });
    await step(run.id, await prisma.agentStep.count({ where: { runId: run.id } }), "limits.rate", { limit: agent.agentProfile.maxRunsPerHour }, { deferredUntil: freeAt.toISOString() });
    return;
  }

  await prisma.agentRun.update({ where: { id: run.id }, data: { startedAt: new Date(), error: null } });
  const principal = await principalFor({ id: agent.id });
  if (!principal || !agent.organizationId) return fail("The agent's account isn't usable");

  let index = await prisma.agentStep.count({ where: { runId: run.id } });
  const usage = { inputTokens: 0, outputTokens: 0, costMicros: 0, usedAi: false };
  const budget = agent.agentProfile.monthlyBudgetMicros;
  const spentBefore = await spentThisMonth(agent.id);
  const env: ToolEnv = { principal, organizationId: agent.organizationId, runId: run.id, agentId: agent.id, agentName: agent.name };

  const tools = Object.fromEntries(
    cap.tools.map((name) => [
      name,
      async (args: unknown) => {
        const started = Date.now();
        const i = index++;
        try {
          const out = await (TOOLS[name].run as (e: ToolEnv, a: unknown) => Promise<unknown>)(env, args);
          await step(run.id, i, name, args, out, null, Date.now() - started);
          await auditAction(env, name, args, out, null);
          return out;
        } catch (error) {
          const message = error instanceof Error ? error.message : "Tool failed";
          await step(run.id, i, name, args, null, message, Date.now() - started);
          await auditAction(env, name, args, null, message);
          throw error;
        }
      },
    ]),
  ) as unknown as Tools;
  // A capability can only reach the tools it declared.
  const guarded = new Proxy(tools, {
    get(target, key: string) {
      if (!(key in target)) throw new ToolError(`${cap.key} has no tool "${key}"`);
      return (target as Record<string, unknown>)[key];
    },
  });

  const provider = aiProvider();
  const ctx: RunContext = {
    run: { id: run.id, organizationId: agent.organizationId, subjectType: run.subjectType as SubjectType, subjectId: run.subjectId, input: JSON.parse(run.input) },
    agent: { id: agent.id, name: agent.name },
    tools: guarded,
    note: async (message) => {
      await step(run.id, index++, "note", { message }, null);
    },
    ask: async (req: AiAsk) => {
      if (!provider) return null;
      if (spentBefore + usage.costMicros >= budget) {
        await step(run.id, index++, "ai.skipped", { task: req.task }, { reason: `Monthly budget of ${formatMicros(budget)} reached — used the rules path` });
        return null;
      }
      const started = Date.now();
      const i = index++;
      try {
        // Secrets never reach a model; the prompt is capped.
        const res = await provider.completeWithUsage({ system: `[task:${req.task}] ${req.system}`, prompt: forModel(req.prompt, 12_000), maxTokens: req.maxTokens ?? 400, timeoutMs: 20_000 });
        const cost = costMicros(res.model, res.inputTokens, res.outputTokens);
        usage.inputTokens += res.inputTokens;
        usage.outputTokens += res.outputTokens;
        usage.costMicros += cost;
        usage.usedAi = true;
        await step(run.id, i, "ai.complete", { task: req.task, model: res.model }, { text: res.text.slice(0, 2000), inputTokens: res.inputTokens, outputTokens: res.outputTokens, costMicros: cost }, null, Date.now() - started);
        return res.text;
      } catch (error) {
        await step(run.id, i, "ai.complete", { task: req.task }, null, error instanceof Error ? error.message : "AI call failed", Date.now() - started);
        return null; // every capability has a path without AI
      }
    },
  };

  try {
    const result = await actingAs({ userId: agent.id, role: "AI_AGENT", organizationId: agent.organizationId }, () => cap.run(ctx));
    const pending = await prisma.approvalRequest.count({ where: { runId: run.id, status: "PENDING" } });
    await prisma.agentRun.update({
      where: { id: run.id },
      data: { status: pending ? "AWAITING_APPROVAL" : "DONE", output: JSON.stringify(result), finishedAt: pending ? null : new Date(), lockedAt: null, mode: usage.usedAi ? "AI" : "RULES", inputTokens: usage.inputTokens, outputTokens: usage.outputTokens, costMicros: usage.costMicros },
    });
    if (run.requestedById) await notify({ userId: run.requestedById, type: "AGENT_NOTICE", title: `${agent.name}: ${result.summary}`.slice(0, 160), body: pending ? "It proposed something that needs a decision." : "Done.", href: `/agents/runs/${run.id}` });
  } catch (error) {
    await prisma.agentRun.update({ where: { id: run.id }, data: { mode: usage.usedAi ? "AI" : "RULES", inputTokens: usage.inputTokens, outputTokens: usage.outputTokens, costMicros: usage.costMicros } });
    await fail(error instanceof Error ? error.message : "The run failed");
  }
}

const trimJson = (v: unknown, max = 4000) => {
  const s = JSON.stringify(v ?? null);
  return stripSecrets(s.length > max ? `${s.slice(0, max)}…` : s);
};

async function step(runId: string, index: number, tool: string, input: unknown, output: unknown, error: string | null = null, durationMs = 0) {
  await prisma.agentStep.create({ data: { runId, index, tool, input: trimJson(input), output: output === null ? null : trimJson(output), error, durationMs } });
}

/** Every tool call is audited with its inputs and outputs, attributed to the agent. */
async function auditAction(env: ToolEnv, tool: ToolName, input: unknown, output: unknown, error: string | null) {
  await prisma.auditLog.create({
    data: { actorId: env.agentId, actorType: "AI", organizationId: env.organizationId, action: "AGENT_ACTION", entityType: "AgentRun", entityId: env.runId, summary: `${env.agentName} · ${tool}${error ? ` failed: ${error}` : ""}`.slice(0, 300), beforeJson: trimJson({ tool, input }), afterJson: trimJson(error ? { error } : output) },
  });
}

/** Test hook and cron entry: run everything due now, in this process. */
export async function runDueNow() {
  if (draining) await draining;
  return asSystem(() => drainQueue(100));
}

export type { Capability };
