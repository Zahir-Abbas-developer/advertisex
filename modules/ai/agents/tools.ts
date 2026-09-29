import "server-only";

import { lookup } from "node:dns/promises";

import { prisma } from "@/lib/prisma";
import { notify } from "@/lib/notifications";
import { stagesFor } from "@/lib/stages";
import { normalizeRole, storedRoleValues, type Action, type Resource } from "@/config/permissions";
import { authorize, type Principal } from "@/modules/rbac/authorize";
import { generateMonthlyReport } from "@/modules/monthly-reports/server";
import { clamp, forModel, htmlToText, injectionSignals, isPrivateAddress, redactPII, urlProblem } from "@/modules/ai/agents/safety";
import { proposeApproval } from "@/modules/ai/agents/approvals";
import { TOOL_GRANTS } from "@/modules/ai/agents/grants";

/**
 * The agent tools (Phase 9 scope 1): typed operations over our own data
 * layer, the same one people use. Each tool names the permission it needs;
 * the agent must hold that grant (config/permissions.ts, AI_AGENT: "grant"),
 * checked with the target's organization and department on every call. The
 * four consequential ones only *propose* — they create an approval request,
 * and a person's decision executes it.
 */

export class ToolError extends Error {}

export type ToolEnv = { principal: Principal; organizationId: string; runId: string; agentId: string; agentName: string };

type ToolDef<A, R> = {
  /** The permission the agent must hold. */
  grant: [Resource, Action];
  describe: string;
  consequential?: true;
  run(env: ToolEnv, args: A): Promise<R>;
};

const allow = (env: ToolEnv, grant: [Resource, Action], target: { organizationId?: string | null; departmentId?: string; clientId?: string }) => {
  const decision = authorize(env.principal, grant[1], grant[0], { ...target, organizationId: target.organizationId ?? undefined });
  if (!decision.allowed) throw new ToolError(`Not permitted: ${grant[0]}:${grant[1]} (${decision.reason})`);
};

async function leadFor(env: ToolEnv, leadId: string, grant: [Resource, Action]) {
  const lead = await prisma.lead.findFirst({ where: { id: leadId, department: { organizationId: env.organizationId } }, include: { department: { select: { id: true, organizationId: true, shortLabel: true } } } });
  if (!lead) throw new ToolError("No such lead");
  allow(env, grant, { organizationId: lead.department.organizationId, departmentId: lead.departmentId });
  return lead;
}

async function clientFor(env: ToolEnv, clientId: string, grant: [Resource, Action]) {
  const client = await prisma.client.findFirst({ where: { id: clientId, organizationId: env.organizationId }, select: { id: true, businessName: true, organizationId: true, departmentId: true, assigneeId: true, clientAccountId: true } });
  if (!client) throw new ToolError("No such client");
  allow(env, grant, { organizationId: client.organizationId, departmentId: client.departmentId, clientId: client.id });
  return client;
}

/** The test suite's local site only: AGENT_FETCH_ALLOW_PRIVATE, and never in production. */
const allowPrivateFetch = () => process.env.AGENT_FETCH_ALLOW_PRIVATE === "true" && process.env.NODE_ENV !== "production";

async function publicAddress(hostname: string) {
  if (allowPrivateFetch()) return;
  const addrs = await lookup(hostname, { all: true }).catch(() => []);
  if (addrs.length === 0) throw new ToolError("That address doesn't resolve");
  if (addrs.some((a) => isPrivateAddress(a.address))) throw new ToolError("Internal addresses aren't fetched");
}

export const TOOLS = {
  "leads.read": {
    grant: [...TOOL_GRANTS["leads.read"]],
    describe: "A lead's details and recent activity — without contact details (PII minimization).",
    async run(env, { leadId }: { leadId: string }) {
      const lead = await leadFor(env, leadId, ["lead", "read"]);
      const [stages, activity] = await Promise.all([
        stagesFor(lead.departmentId),
        prisma.salesActivity.findMany({ where: { leadId: lead.id }, orderBy: { occurredAt: "desc" }, take: 8, select: { type: true, note: true, occurredAt: true } }),
      ]);
      const stage = stages.find((s) => s.key === lead.stage);
      return {
        id: lead.id,
        businessName: lead.businessName,
        contactFirstName: lead.contactName.split(" ")[0],
        department: lead.department.shortLabel,
        departmentId: lead.departmentId,
        ownerId: lead.ownerId,
        stage: lead.stage,
        stageLabel: stage?.label ?? lead.stage,
        stageKind: stage?.kind ?? "OPEN",
        /** Where a won/lost proposal would move it. */
        outcomeStages: stages.filter((s) => s.kind === "WON" || s.kind === "LOST").map((s) => ({ key: s.key, label: s.label, kind: s.kind })),
        source: lead.source,
        industry: lead.industry,
        location: lead.location,
        country: lead.country,
        website: lead.website,
        interestedServices: lead.interestedServices,
        estimatedMonthlyValue: lead.estimatedMonthlyValue,
        dealValue: lead.dealValue,
        tags: lead.tags ? lead.tags.split(",").filter(Boolean) : [],
        notes: lead.notes ? clamp(redactPII(lead.notes), 1200) : null,
        createdAt: lead.createdAt.toISOString(),
        recent: activity.map((a) => ({ type: a.type, note: clamp(redactPII(a.note), 240), at: a.occurredAt.toISOString().slice(0, 10) })),
      };
    },
  } satisfies ToolDef<{ leadId: string }, unknown>,

  "leads.addNote": {
    grant: [...TOOL_GRANTS["leads.addNote"]],
    describe: "Adds a note to a lead's timeline, signed by the agent.",
    async run(env, { leadId, note }: { leadId: string; note: string }) {
      const lead = await leadFor(env, leadId, ["activity", "create"]);
      const row = await prisma.salesActivity.create({ data: { departmentId: lead.departmentId, leadId: lead.id, userId: env.agentId, type: "NOTE", note: clamp(note.trim(), 4000) } });
      return { activityId: row.id };
    },
  } satisfies ToolDef<{ leadId: string; note: string }, unknown>,

  "leads.tag": {
    grant: [...TOOL_GRANTS["leads.tag"]],
    describe: "Adds tags to a lead (lower-case, comma-free).",
    async run(env, { leadId, tags }: { leadId: string; tags: string[] }) {
      const lead = await leadFor(env, leadId, ["lead", "update"]);
      const clean = tags.map((t) => t.toLowerCase().replace(/[^a-z0-9:-]+/g, "-").slice(0, 32)).filter(Boolean);
      // Replace any earlier tag with the same prefix ("fit:hot" replaces "fit:cold").
      const prefixes = new Set(clean.map((t) => t.split(":")[0] + ":").filter((p) => p.length > 1 && clean.some((t) => t.includes(":"))));
      const kept = (lead.tags ? lead.tags.split(",") : []).filter((t) => t && ![...prefixes].some((p) => t.startsWith(p)));
      const next = [...new Set([...kept, ...clean])].join(",");
      await prisma.lead.update({ where: { id: lead.id }, data: { tags: next } });
      return { tags: next.split(",") };
    },
  } satisfies ToolDef<{ leadId: string; tags: string[] }, unknown>,

  "leads.proposeOutcome": {
    grant: [...TOOL_GRANTS["leads.proposeOutcome"]],
    consequential: true,
    describe: "Proposes marking a lead won or lost — a person decides.",
    async run(env, { leadId, toStageKey, reason, lostReason }: { leadId: string; toStageKey: string; reason: string; lostReason?: string }) {
      const lead = await leadFor(env, leadId, ["lead", "update"]);
      const stage = (await stagesFor(lead.departmentId)).find((s) => s.key === toStageKey);
      if (!stage || (stage.kind !== "WON" && stage.kind !== "LOST")) throw new ToolError("Only a won or lost stage can be proposed");
      return proposeApproval(env, { kind: "LEAD_OUTCOME", subjectType: "lead", subjectId: lead.id, summary: `Mark ${lead.businessName} as ${stage.label}: ${clamp(reason, 160)}`, payload: { leadId: lead.id, toStageKey, lostReason: lostReason ?? null } });
    },
  } satisfies ToolDef<{ leadId: string; toStageKey: string; reason: string; lostReason?: string }, unknown>,

  "web.fetch": {
    grant: [...TOOL_GRANTS["web.fetch"]],
    describe: "Reads a public web page (https/http, public addresses only), as untrusted text.",
    async run(_env, { url }: { url: string }) {
      // Redirects are followed by hand (up to three), and every hop is checked
      // again — a public page must not be able to redirect us inward.
      let current = url;
      let res: Response | null = null;
      for (let hop = 0; hop < 4; hop++) {
        const problem = urlProblem(current, allowPrivateFetch());
        if (problem) throw new ToolError(problem);
        await publicAddress(new URL(current).hostname);
        res = await fetch(current, { redirect: "manual", signal: AbortSignal.timeout(8_000), headers: { "User-Agent": "AdvertiseX-Research/1.0 (+https://advertisex.example)", Accept: "text/html" } });
        const next = res.status >= 300 && res.status < 400 ? res.headers.get("location") : null;
        if (!next) break;
        if (hop === 3) throw new ToolError("Too many redirects");
        current = new URL(next, current).toString();
      }
      if (!res) throw new ToolError("No response");
      if (!res.ok) throw new ToolError(`The site answered ${res.status}`);
      if (!(res.headers.get("content-type") ?? "").includes("text/html")) throw new ToolError("Not a web page");
      const reader = res.body?.getReader();
      let html = "";
      if (reader) {
        const decoder = new TextDecoder();
        let bytes = 0;
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          bytes += value.byteLength;
          html += decoder.decode(value, { stream: true });
          if (bytes > 500_000) break; // enough to read a restaurant's homepage
        }
      }
      const page = htmlToText(html);
      return { status: res.status, title: page.title, description: page.description, text: clamp(page.text, 8000), links: page.links, injection: injectionSignals(`${page.title} ${page.description} ${page.text}`) };
    },
  } satisfies ToolDef<{ url: string }, unknown>,

  "tasks.create": {
    grant: [...TOOL_GRANTS["tasks.create"]],
    describe: "Creates a task (for a lead, a client or a project) and tells the assignee.",
    async run(env, a: { title: string; note?: string; dueInDays?: number; assigneeId?: string | null; leadId?: string; clientId?: string; projectId?: string }) {
      let departmentId: string | null = null;
      let clientId = a.clientId ?? null;
      if (a.projectId) {
        const p = await prisma.project.findFirst({ where: { id: a.projectId, organizationId: env.organizationId }, select: { clientId: true, client: { select: { departmentId: true } } } });
        if (!p) throw new ToolError("No such project");
        departmentId = p.client.departmentId;
        clientId = p.clientId;
      } else if (a.leadId) {
        departmentId = (await leadFor(env, a.leadId, ["task", "create"])).departmentId;
      } else if (a.clientId) {
        departmentId = (await clientFor(env, a.clientId, ["task", "create"])).departmentId;
      }
      if (!departmentId) throw new ToolError("A task needs a lead, a client or a project");
      allow(env, ["task", "create"], { organizationId: env.organizationId, departmentId });
      if (a.assigneeId) {
        const member = await prisma.user.findFirst({ where: { id: a.assigneeId, organizationId: env.organizationId, isActive: true, role: { not: "CLIENT" } }, select: { id: true } });
        if (!member) throw new ToolError("That assignee isn't on the team");
      }
      const due = a.dueInDays !== undefined ? new Date(Date.now() + Math.max(0, Math.min(90, a.dueInDays)) * 86_400_000) : null;
      const task = await prisma.task.create({
        data: { departmentId, leadId: a.leadId ?? null, clientId: a.leadId ? null : clientId, projectId: a.projectId ?? null, title: clamp(a.title.trim(), 160), note: a.note ? clamp(a.note, 4000) : null, assigneeId: a.assigneeId ?? null, createdById: env.agentId, dueAt: due ? new Date(`${due.toISOString().slice(0, 10)}T00:00:00.000Z`) : null, status: "NOT_STARTED", priority: "MEDIUM" },
      });
      if (a.assigneeId) await notify({ userId: a.assigneeId, type: "TASK_ASSIGNED", title: `${env.agentName} created a task for you`, body: task.title, href: "/tasks" });
      return { taskId: task.id };
    },
  } satisfies ToolDef<{ title: string }, unknown>,

  "projects.read": {
    grant: [...TOOL_GRANTS["projects.read"]],
    describe: "A project's brief, services, stages, team and dates.",
    async run(env, { projectId }: { projectId: string }) {
      const p = await prisma.project.findFirst({
        where: { id: projectId, organizationId: env.organizationId },
        select: { id: true, title: true, description: true, status: true, startDate: true, endDate: true, ownerId: true, clientId: true, client: { select: { businessName: true, departmentId: true, organizationId: true } }, services: { select: { service: { select: { name: true } } } }, stages: { orderBy: { order: "asc" }, select: { name: true, status: true } }, members: { select: { userId: true, user: { select: { name: true } } } } },
      });
      if (!p) throw new ToolError("No such project");
      allow(env, ["project", "read"], { organizationId: p.client.organizationId, departmentId: p.client.departmentId, clientId: p.clientId });
      return { id: p.id, title: p.title, brief: p.description ? forModel(p.description, 3000) : "", status: p.status, start: p.startDate.toISOString().slice(0, 10), deadline: p.endDate.toISOString().slice(0, 10), ownerId: p.ownerId, clientId: p.clientId, client: p.client.businessName, services: p.services.map((s) => s.service.name), stages: p.stages, team: p.members.map((m) => ({ id: m.userId, name: m.user.name })) };
    },
  } satisfies ToolDef<{ projectId: string }, unknown>,

  "reports.draft": {
    grant: [...TOOL_GRANTS["reports.draft"]],
    describe: "Drafts a client's monthly report (Phase 8) — a draft that needs review.",
    async run(env, { clientId, month }: { clientId: string; month: string }) {
      await clientFor(env, clientId, ["clientReport", "create"]);
      if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new ToolError("A month like 2026-08");
      const { report, created } = await generateMonthlyReport(clientId, month, { createdById: env.agentId });
      return { reportId: report.id, created, status: report.status, summarySource: report.summarySource };
    },
  } satisfies ToolDef<{ clientId: string; month: string }, unknown>,

  "reports.proposePublish": {
    grant: [...TOOL_GRANTS["reports.proposePublish"]],
    consequential: true,
    describe: "Proposes publishing a drafted report to the client — a person decides.",
    async run(env, { reportId }: { reportId: string }) {
      const r = await prisma.clientReport.findFirst({ where: { id: reportId, organizationId: env.organizationId }, select: { id: true, title: true, clientId: true, status: true, client: { select: { businessName: true } } } });
      if (!r) throw new ToolError("No such report");
      await clientFor(env, r.clientId, ["clientReport", "update"]);
      if (r.status === "PUBLISHED") return { skipped: "already published" };
      return proposeApproval(env, { kind: "PUBLISH_REPORT", subjectType: "client", subjectId: r.clientId, summary: `Publish "${r.title}" to ${r.client.businessName}`, payload: { reportId: r.id } });
    },
  } satisfies ToolDef<{ reportId: string }, unknown>,

  "notify.team": {
    grant: [...TOOL_GRANTS["notify.team"]],
    describe: "Posts an internal notice to team members (never to clients) — the founders when no one is named.",
    async run(env, { userIds, title, body, href }: { userIds?: string[]; title: string; body: string; href?: string }) {
      allow(env, ["notification", "create"], { organizationId: env.organizationId });
      const who = userIds?.length ? { id: { in: userIds } } : { role: { in: storedRoleValues("FOUNDER") } };
      const people = await prisma.user.findMany({ where: { ...who, organizationId: env.organizationId, isActive: true }, select: { id: true, role: true } });
      let sent = 0;
      for (const p of people) {
        if (normalizeRole(p.role) === "CLIENT") continue; // internal only, whatever the caller passed
        if (await notify({ userId: p.id, type: "AGENT_NOTICE", title: `${env.agentName}: ${clamp(title, 120)}`, body: clamp(body, 600), href: href ?? `/agents/runs/${env.runId}` })) sent += 1;
      }
      return { sent };
    },
  } satisfies ToolDef<{ title: string; body: string }, unknown>,

  "messages.proposeToClient": {
    grant: [...TOOL_GRANTS["messages.proposeToClient"]],
    consequential: true,
    describe: "Proposes a message to a client — a person reviews and sends it.",
    async run(env, { clientId, body }: { clientId: string; body: string }) {
      const client = await clientFor(env, clientId, ["message", "create"]);
      return proposeApproval(env, { kind: "SEND_CLIENT_MESSAGE", subjectType: "client", subjectId: client.id, summary: `Message ${client.businessName}: "${clamp(body, 80)}"`, payload: { clientId: client.id, body: clamp(body, 4000) } });
    },
  } satisfies ToolDef<{ clientId: string; body: string }, unknown>,

  "invoices.propose": {
    grant: [...TOOL_GRANTS["invoices.propose"]],
    consequential: true,
    describe: "Proposes a draft invoice — the founder decides.",
    async run(env, { clientId, lines, dueInDays }: { clientId: string; lines: { description: string; quantity: string; rate: string }[]; dueInDays?: number }) {
      const client = await clientFor(env, clientId, ["invoice", "create"]);
      return proposeApproval(env, { kind: "CREATE_INVOICE", subjectType: "client", subjectId: client.id, summary: `Draft an invoice for ${client.businessName} (${lines.length} line${lines.length === 1 ? "" : "s"})`, payload: { clientId: client.id, lines, dueInDays: dueInDays ?? 14 } });
    },
  } satisfies ToolDef<{ clientId: string; lines: { description: string; quantity: string; rate: string }[] }, unknown>,

  "pipeline.snapshot": {
    grant: [...TOOL_GRANTS["pipeline.snapshot"]],
    describe: "Counts for a summary: new and won leads this week, stale deals, overdue tasks, delayed projects.",
    async run(env) {
      allow(env, ["lead", "read"], { organizationId: env.organizationId });
      const weekAgo = new Date(Date.now() - 7 * 86_400_000);
      const org = { department: { organizationId: env.organizationId } };
      const [newLeads, won, stale, overdueTasks, delayed] = await Promise.all([
        prisma.lead.count({ where: { ...org, createdAt: { gte: weekAgo } } }),
        prisma.salesActivity.count({ where: { ...org, type: "DEAL_CLOSED", occurredAt: { gte: weekAgo } } }),
        prisma.lead.count({ where: { ...org, stageChangedAt: { lt: new Date(Date.now() - 21 * 86_400_000) }, stage: { notIn: ["WON", "LOST", "ACTIVE_CLIENT"] } } }),
        prisma.task.count({ where: { ...org, completedAt: null, dueAt: { lt: new Date() }, status: { notIn: ["COMPLETED", "DONE"] } } }),
        prisma.project.count({ where: { organizationId: env.organizationId, status: { in: ["PLANNING", "ACTIVE", "ON_HOLD"] }, delayedAt: { not: null } } }),
      ]);
      return { newLeads, won, stale, overdueTasks, delayed };
    },
  } satisfies ToolDef<Record<string, never>, unknown>,
} as const;

export type ToolName = keyof typeof TOOLS;
/** A tool that takes no arguments is called with `{}`. */
type Args<T extends ToolName> = Parameters<(typeof TOOLS)[T]["run"]> extends [unknown, infer A] ? A : Record<string, never>;
type Out<T extends ToolName> = Awaited<ReturnType<(typeof TOOLS)[T]["run"]>>;
export type Tools = { [K in ToolName]: (args: Args<K>) => Promise<Out<K>> };

export const toolGrant = (name: ToolName) => TOOLS[name].grant;
export const isConsequential = (name: ToolName) => "consequential" in TOOLS[name] && TOOLS[name].consequential === true;
