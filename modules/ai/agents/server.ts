import "server-only";

import { randomBytes } from "node:crypto";

import type { Prisma } from "@prisma/client";

import { prisma } from "@/lib/prisma";
import { hashPassword } from "@/lib/passwords";
import { avatarColorFor } from "@/lib/constants";
import { storedRoleValues } from "@/config/permissions";
import { authorize, type Principal } from "@/modules/rbac/authorize";
import { CAPABILITIES, capability as findCapability } from "@/modules/ai/agents/registry";
import { grantsFor } from "@/modules/ai/agents/grants";
import { enqueueRun, RunError, subjectDepartment } from "@/modules/ai/agents/queue";
import type { SubjectType } from "@/modules/ai/agents/capability";

/**
 * Reads and writes behind /agents, /approvals and the team views (Phase 9
 * scope 5). Who sees a run: founders, anything in their organization;
 * managers, runs about their departments' records; employees, their
 * departments' leads and the clients and projects they work on; everyone,
 * runs they asked for. Performance is work, not attendance: runs completed, approval rate,
 * spend.
 */

const PAGE = 25;
const monthStart = () => {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
};

export function runScope(principal: Principal): Prisma.AgentRunWhereInput {
  const org = { organizationId: principal.organizationId ?? "__none__" };
  if (principal.role === "FOUNDER") return org;
  const departments = { in: [...principal.departmentIds] };
  if (principal.role === "MANAGER") return { ...org, OR: [{ departmentId: departments }, { requestedById: principal.id }] };
  // Employees (Phase 10): a run's steps show what the agent read, so they
  // follow the employee's own reach — their departments' leads, and only the
  // clients and projects they work on.
  return {
    ...org,
    OR: [
      { requestedById: principal.id },
      { subjectType: "lead", departmentId: departments },
      { subjectType: "client", subjectId: { in: [...principal.assignedClientIds] } },
      { subjectType: "project", subjectId: { in: [...principal.assignedProjectIds] } },
    ],
  };
}

export function approvalScope(principal: Principal): Prisma.ApprovalRequestWhereInput {
  const org = { organizationId: principal.organizationId ?? "__none__" };
  if (principal.role === "FOUNDER") return org;
  if (principal.role !== "MANAGER") return { id: "__none__" };
  return { ...org, departmentId: { in: [...principal.departmentIds] }, kind: { not: "CREATE_INVOICE" } };
}

export type AgentPerformance = { done: number; failed: number; active: number; awaiting: number; approved: number; rejected: number; approvalRate: number | null; costMonthMicros: number; runsMonth: number; lastRunAt: string | null };

/** Performance per agent — the definitions are in docs/METRICS.md → "AI employees". */
export async function agentPerformance(agentIds: string[]): Promise<Map<string, AgentPerformance>> {
  const since = monthStart();
  const [byStatus, byDecision, month, last] = await Promise.all([
    prisma.agentRun.groupBy({ by: ["agentId", "status"], where: { agentId: { in: agentIds } }, _count: { _all: true } }),
    prisma.approvalRequest.groupBy({ by: ["agentId", "status"], where: { agentId: { in: agentIds }, status: { in: ["APPROVED", "REJECTED", "FAILED"] } }, _count: { _all: true } }),
    prisma.agentRun.groupBy({ by: ["agentId"], where: { agentId: { in: agentIds }, createdAt: { gte: since } }, _sum: { costMicros: true }, _count: { _all: true } }),
    prisma.agentRun.groupBy({ by: ["agentId"], where: { agentId: { in: agentIds } }, _max: { createdAt: true } }),
  ]);
  const out = new Map<string, AgentPerformance>();
  for (const id of agentIds) {
    const count = (status: string) => byStatus.find((r) => r.agentId === id && r.status === status)?._count._all ?? 0;
    const decided = (status: string) => byDecision.find((r) => r.agentId === id && r.status === status)?._count._all ?? 0;
    // A proposal approved but failing on execution still counts as approved: the judgement was accepted.
    const approved = decided("APPROVED") + decided("FAILED");
    const rejected = decided("REJECTED");
    const m = month.find((r) => r.agentId === id);
    out.set(id, {
      done: count("DONE"),
      failed: count("FAILED"),
      active: count("QUEUED") + count("RUNNING"),
      awaiting: count("AWAITING_APPROVAL"),
      approved,
      rejected,
      approvalRate: approved + rejected > 0 ? approved / (approved + rejected) : null,
      costMonthMicros: m?._sum.costMicros ?? 0,
      runsMonth: m?._count._all ?? 0,
      lastRunAt: last.find((r) => r.agentId === id)?._max.createdAt?.toISOString() ?? null,
    });
  }
  return out;
}

export async function listAgents(principal: Principal) {
  const agents = await prisma.user.findMany({
    where: { organizationId: principal.organizationId ?? "__none__", role: { in: storedRoleValues("AI_AGENT") } },
    orderBy: { name: "asc" },
    select: { id: true, name: true, jobTitle: true, avatarColor: true, isActive: true, agentProfile: true, agentGrants: { select: { resource: true, action: true } } },
  });
  const perf = await agentPerformance(agents.map((a) => a.id));
  const seeCost = principal.role !== "EMPLOYEE";
  return agents.map((a) => {
    const cap = a.agentProfile ? findCapability(a.agentProfile.capability) : undefined;
    const held = new Set(a.agentGrants.map((g) => `${g.resource}:${g.action}`));
    const p = perf.get(a.id)!;
    return {
      id: a.id,
      name: a.name,
      jobTitle: a.jobTitle,
      avatarColor: a.avatarColor,
      active: a.isActive,
      capability: cap ? { key: cap.key, name: cap.name, description: cap.description, subjectType: cap.subjectType, tools: [...cap.tools] } : null,
      enabled: a.agentProfile?.enabled ?? false,
      maxRunsPerHour: a.agentProfile?.maxRunsPerHour ?? 0,
      monthlyBudgetMicros: seeCost ? (a.agentProfile?.monthlyBudgetMicros ?? 0) : null,
      missingGrants: cap ? grantsFor(cap).filter(([r, act]) => !held.has(`${r}:${act}`)).map(([r, act]) => `${r}:${act}`) : [],
      performance: { ...p, costMonthMicros: seeCost ? p.costMonthMicros : null },
    };
  });
}

export type AgentRow = Awaited<ReturnType<typeof listAgents>>[number];

async function subjectLabels(rows: { subjectType: string; subjectId: string | null }[]) {
  const ids = (t: string) => [...new Set(rows.filter((r) => r.subjectType === t && r.subjectId).map((r) => r.subjectId!))];
  const [leads, clients, projects] = await Promise.all([
    prisma.lead.findMany({ where: { id: { in: ids("lead") } }, select: { id: true, businessName: true } }),
    prisma.client.findMany({ where: { id: { in: ids("client") } }, select: { id: true, businessName: true } }),
    prisma.project.findMany({ where: { id: { in: ids("project") } }, select: { id: true, title: true } }),
  ]);
  const map = new Map<string, { label: string; href: string }>();
  for (const l of leads) map.set(`lead:${l.id}`, { label: l.businessName, href: `/pipeline?lead=${l.id}` });
  for (const c of clients) map.set(`client:${c.id}`, { label: c.businessName, href: `/clients/${c.id}` });
  for (const p of projects) map.set(`project:${p.id}`, { label: p.title, href: `/projects/${p.id}` });
  return (r: { subjectType: string; subjectId: string | null }) => (r.subjectId ? (map.get(`${r.subjectType}:${r.subjectId}`) ?? { label: "Deleted record", href: null }) : { label: "The whole agency", href: null });
}

export async function listRuns(principal: Principal, filter: { agentId?: string; status?: string; page?: number }) {
  const where: Prisma.AgentRunWhereInput = { AND: [runScope(principal), filter.agentId ? { agentId: filter.agentId } : {}, filter.status ? { status: filter.status } : {}] };
  const page = Math.max(1, filter.page ?? 1);
  const [total, rows] = await Promise.all([
    prisma.agentRun.count({ where }),
    prisma.agentRun.findMany({ where, orderBy: { createdAt: "desc" }, skip: (page - 1) * PAGE, take: PAGE, select: { id: true, capability: true, subjectType: true, subjectId: true, status: true, output: true, error: true, mode: true, costMicros: true, createdAt: true, finishedAt: true, agent: { select: { id: true, name: true, avatarColor: true } }, requestedBy: { select: { name: true } }, rule: { select: { name: true } } } }),
  ]);
  const label = await subjectLabels(rows);
  const seeCost = principal.role !== "EMPLOYEE";
  return {
    total,
    page,
    pageSize: PAGE,
    runs: rows.map((r) => ({
      id: r.id,
      agent: r.agent,
      capability: findCapability(r.capability)?.name ?? r.capability,
      subject: label(r),
      status: r.status,
      summary: r.output ? (JSON.parse(r.output) as { summary?: string }).summary ?? null : null,
      error: r.error,
      mode: r.mode,
      costMicros: seeCost ? r.costMicros : null,
      requestedBy: r.requestedBy?.name ?? (r.rule ? `Automation: ${r.rule.name}` : null),
      createdAt: r.createdAt.toISOString(),
      finishedAt: r.finishedAt?.toISOString() ?? null,
    })),
  };
}

export type RunRow = Awaited<ReturnType<typeof listRuns>>["runs"][number];

export async function runDetail(principal: Principal, id: string) {
  const run = await prisma.agentRun.findFirst({
    where: { AND: [runScope(principal), { id }] },
    include: { agent: { select: { id: true, name: true, avatarColor: true, jobTitle: true } }, requestedBy: { select: { name: true } }, rule: { select: { name: true } }, steps: { orderBy: { index: "asc" } }, approvals: { orderBy: { createdAt: "asc" }, include: { decidedBy: { select: { name: true } } } } },
  });
  if (!run) return null;
  const label = await subjectLabels([run]);
  const seeCost = principal.role !== "EMPLOYEE";
  return {
    id: run.id,
    agent: run.agent,
    capability: findCapability(run.capability)?.name ?? run.capability,
    subject: label(run),
    status: run.status,
    error: run.error,
    output: run.output ? (JSON.parse(run.output) as { summary: string; data?: Record<string, unknown> }) : null,
    mode: run.mode,
    usage: seeCost ? { inputTokens: run.inputTokens, outputTokens: run.outputTokens, costMicros: run.costMicros } : null,
    requestedBy: run.requestedBy?.name ?? (run.rule ? `Automation: ${run.rule.name}` : null),
    createdAt: run.createdAt.toISOString(),
    startedAt: run.startedAt?.toISOString() ?? null,
    finishedAt: run.finishedAt?.toISOString() ?? null,
    steps: run.steps.map((s) => ({ index: s.index, tool: s.tool, input: s.input, output: s.output, error: s.error, durationMs: s.durationMs })),
    approvals: run.approvals.map((a) => ({ id: a.id, kind: a.kind, summary: a.summary, status: a.status, decidedBy: a.decidedBy?.name ?? null, decidedAt: a.decidedAt?.toISOString() ?? null, note: a.note })),
  };
}

export type RunDetail = NonNullable<Awaited<ReturnType<typeof runDetail>>>;

export async function listApprovals(principal: Principal, status: "PENDING" | "DECIDED") {
  const where: Prisma.ApprovalRequestWhereInput = { AND: [approvalScope(principal), status === "PENDING" ? { status: "PENDING" } : { status: { not: "PENDING" } }] };
  const rows = await prisma.approvalRequest.findMany({ where, orderBy: { createdAt: status === "PENDING" ? "asc" : "desc" }, take: 100, include: { agent: { select: { id: true, name: true, avatarColor: true } }, decidedBy: { select: { name: true } } } });
  const label = await subjectLabels(rows.map((r) => ({ subjectType: r.subjectType, subjectId: r.subjectId })));
  return rows.map((r) => ({
    id: r.id,
    kind: r.kind,
    summary: r.summary,
    payload: JSON.parse(r.payload) as Record<string, unknown>,
    status: r.status,
    agent: r.agent,
    runId: r.runId,
    subject: label(r),
    note: r.note,
    result: r.result ? (JSON.parse(r.result) as Record<string, unknown>) : null,
    decidedBy: r.decidedBy?.name ?? null,
    decidedAt: r.decidedAt?.toISOString() ?? null,
    createdAt: r.createdAt.toISOString(),
  }));
}

export type ApprovalRow = Awaited<ReturnType<typeof listApprovals>>[number];

export const pendingApprovalCount = (principal: Principal) => prisma.approvalRequest.count({ where: { AND: [approvalScope(principal), { status: "PENDING" }] } });

/** Start a run by hand. Founders anywhere; managers on their departments' records. */
export async function startRun(principal: Principal, input: { agentId: string; subjectType: SubjectType; subjectId: string | null; brief?: string | null }) {
  const organizationId = principal.organizationId;
  if (!organizationId) throw new RunError("Your account isn't in an organization", 403);
  const departmentId = await subjectDepartment(organizationId, input.subjectType, input.subjectId);
  if (input.subjectType !== "organization" && !departmentId) throw new RunError(`That ${input.subjectType} doesn't exist`, 404);
  const target = input.subjectType === "organization" ? { organizationId } : { organizationId, departmentId };
  if (input.subjectType === "organization" && principal.role !== "FOUNDER") throw new RunError("Only a founder can start agency-wide work", 403);
  if (!authorize(principal, "create", "agent", target).allowed) throw new RunError("You can't give an agent work on that", 403);
  return enqueueRun({ organizationId, agentId: input.agentId, subjectType: input.subjectType, subjectId: input.subjectId, input: input.brief ? { brief: input.brief } : {}, requestedById: principal.id });
}

/** Grants a capability needs that the agent lacks get added, attributed to the founder. */
async function grantFor(organizationId: string, agentId: string, capKey: string, grantedById: string) {
  const cap = findCapability(capKey)!;
  const held = await prisma.agentGrant.findMany({ where: { agentId }, select: { resource: true, action: true } });
  const have = new Set(held.map((g) => `${g.resource}:${g.action}`));
  const missing = grantsFor(cap).filter(([r, a]) => !have.has(`${r}:${a}`));
  for (const [resource, action] of missing) await prisma.agentGrant.create({ data: { organizationId, agentId, resource, action, grantedById } });
  return missing.length;
}

/** Hire: a new AI employee with one capability, its default limits and the grants it needs. */
export async function hireAgent(principal: Principal, input: { name: string; jobTitle?: string | null; capability: string }) {
  const cap = findCapability(input.capability);
  if (!cap) throw new RunError("Pick a capability");
  const organizationId = principal.organizationId!;
  const slug = input.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "agent";
  const user = await prisma.user.create({
    data: {
      organizationId,
      name: input.name,
      email: `${slug}.${randomBytes(3).toString("hex")}@agents.invalid`,
      // Unusable by design: agents never sign in.
      passwordHash: await hashPassword(randomBytes(32).toString("hex")),
      role: "AI_AGENT",
      jobTitle: input.jobTitle || cap.name,
      avatarColor: avatarColorFor(input.name),
    },
  });
  await prisma.agentProfile.create({ data: { userId: user.id, capability: cap.key, maxRunsPerHour: cap.defaults.maxRunsPerHour, monthlyBudgetMicros: cap.defaults.monthlyBudgetMicros } });
  await grantFor(organizationId, user.id, cap.key, principal.id);
  return user;
}

async function agentInOrg(principal: Principal, agentId: string) {
  const agent = await prisma.user.findFirst({ where: { id: agentId, organizationId: principal.organizationId ?? "__none__", role: { in: storedRoleValues("AI_AGENT") } }, select: { id: true } });
  if (!agent) throw new RunError("No such agent", 404);
  return agent;
}

/** Change an agent's capability, pause it, or set its limits. Founder only (checked by the route). */
export async function updateAgent(principal: Principal, agentId: string, input: { capability?: string; enabled?: boolean; maxRunsPerHour?: number; monthlyBudgetMicros?: number }) {
  await agentInOrg(principal, agentId);
  const existing = await prisma.agentProfile.findUnique({ where: { userId: agentId } });
  const capKey = input.capability ?? existing?.capability;
  const cap = capKey ? findCapability(capKey) : undefined;
  if (!cap) throw new RunError("Pick a capability");
  const data = { capability: cap.key, enabled: input.enabled, maxRunsPerHour: input.maxRunsPerHour, monthlyBudgetMicros: input.monthlyBudgetMicros };
  const profile = existing
    ? await prisma.agentProfile.update({ where: { userId: agentId }, data })
    : await prisma.agentProfile.create({ data: { userId: agentId, ...data, maxRunsPerHour: input.maxRunsPerHour ?? cap.defaults.maxRunsPerHour, monthlyBudgetMicros: input.monthlyBudgetMicros ?? cap.defaults.monthlyBudgetMicros } });
  const added = input.capability ? await grantFor(principal.organizationId!, agentId, cap.key, principal.id) : 0;
  return { profile, grantsAdded: added };
}

export const capabilityCatalog = () => CAPABILITIES.map((c) => ({ key: c.key, name: c.name, description: c.description, subjectType: c.subjectType, tools: [...c.tools], grants: grantsFor(c).map(([r, a]) => `${r}:${a}`) }));

/** Records a person may give an agent work on: `type` + a name fragment. Founders: the organization; managers: their departments. */
export async function searchSubjects(principal: Principal, type: "lead" | "client" | "project", q: string) {
  const organizationId = principal.organizationId ?? "__none__";
  const depts = principal.role === "FOUNDER" ? undefined : { in: [...principal.departmentIds] };
  const text = q.trim().slice(0, 60);
  if (type === "lead") {
    const rows = await prisma.lead.findMany({ where: { department: { organizationId }, ...(depts ? { departmentId: depts } : {}), ...(text ? { businessName: { contains: text } } : {}) }, orderBy: { updatedAt: "desc" }, take: 8, select: { id: true, businessName: true, department: { select: { shortLabel: true } } } });
    return rows.map((r) => ({ id: r.id, label: r.businessName, hint: r.department.shortLabel }));
  }
  if (type === "client") {
    const rows = await prisma.client.findMany({ where: { organizationId, ...(depts ? { departmentId: depts } : {}), ...(text ? { businessName: { contains: text } } : {}) }, orderBy: { businessName: "asc" }, take: 8, select: { id: true, businessName: true, status: true } });
    return rows.map((r) => ({ id: r.id, label: r.businessName, hint: r.status === "ACTIVE" ? "Client" : r.status.toLowerCase() }));
  }
  const rows = await prisma.project.findMany({ where: { organizationId, ...(depts ? { client: { departmentId: depts } } : {}), ...(text ? { title: { contains: text } } : {}) }, orderBy: { updatedAt: "desc" }, take: 8, select: { id: true, title: true, client: { select: { businessName: true } } } });
  return rows.map((r) => ({ id: r.id, label: r.title, hint: r.client.businessName }));
}
