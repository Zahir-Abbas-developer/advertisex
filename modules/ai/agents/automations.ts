import { prisma } from "@/lib/prisma";
import { notify } from "@/lib/notifications";
import { storedRoleValues } from "@/config/permissions";
import { asSystem } from "@/modules/tenancy/context";
import { capability as findCapability } from "@/modules/ai/agents/registry";
import { enqueueRun } from "@/modules/ai/agents/queue";
import { actionConfigSchemas, conditionsSchema, matches, subjectKey, type AutomationAction, type EventPayload, type Trigger } from "@/modules/ai/agents/triggers";

/**
 * Automations (Phase 9 scope 4): founder-written rules — "when this happens
 * (and these conditions hold), do that". Four triggers, three actions.
 *
 * Events are emitted by the code that already owns the moment (lead
 * creation, moveLeadStage, the morning sweep, the monthly report job).
 * Emitting never fails the caller: a broken rule is logged on the rule, not
 * surfaced as a failed lead creation. Each rule fires at most once per
 * subject key (AutomationFiring), so a retried job or a doubled event can't
 * run an agent twice.
 */

export { ACTIONS, ACTION_LABEL, TRIGGERS, TRIGGER_LABEL, actionConfigSchemas, conditionsSchema, matches, subjectKey } from "@/modules/ai/agents/triggers";
export type { AutomationAction, Conditions, EventPayload, Trigger } from "@/modules/ai/agents/triggers";

/**
 * Fire every enabled rule for this event. Returns what happened, per rule —
 * for the caller's logs and the tests; callers otherwise ignore it.
 */
export async function emitEvent(organizationId: string, trigger: Trigger, payload: EventPayload) {
  try {
    return await asSystem(() => fire(organizationId, trigger, payload));
  } catch (error) {
    console.error("automation event failed", trigger, error);
    return [];
  }
}

async function fire(organizationId: string, trigger: Trigger, payload: EventPayload) {
  const rules = await prisma.automationRule.findMany({ where: { organizationId, trigger, enabled: true }, orderBy: { createdAt: "asc" } });
  const results: { ruleId: string; outcome: string }[] = [];
  for (const rule of rules) {
    const conditions = conditionsSchema.safeParse(JSON.parse(rule.conditions));
    if (!conditions.success || !matches(conditions.data, payload)) continue;
    const key = subjectKey(trigger, payload);
    // Claim the firing first: the unique key makes a duplicate a no-op.
    const claimed = await prisma.automationFiring.create({ data: { ruleId: rule.id, subjectKey: key, outcome: "pending" } }).catch(() => null);
    if (!claimed) continue;
    let outcome: string;
    try {
      outcome = await perform(rule, organizationId, payload);
    } catch (error) {
      outcome = `failed: ${error instanceof Error ? error.message : "unknown error"}`.slice(0, 200);
    }
    await prisma.automationFiring.update({ where: { id: claimed.id }, data: { outcome } });
    await prisma.automationRule.update({ where: { id: rule.id }, data: { fireCount: { increment: 1 }, lastFiredAt: new Date() } });
    await prisma.auditLog.create({
      data: { actorId: null, actorType: "SYSTEM", organizationId, action: "AUTOMATION_FIRED", entityType: "AutomationRule", entityId: rule.id, summary: `${rule.name}: ${outcome}`.slice(0, 300), beforeJson: JSON.stringify({ trigger, payload }), afterJson: JSON.stringify({ outcome }) },
    });
    results.push({ ruleId: rule.id, outcome });
  }
  return results;
}

type Rule = { id: string; name: string; action: string; actionConfig: string; createdById: string | null };

async function perform(rule: Rule, organizationId: string, p: EventPayload): Promise<string> {
  const raw = JSON.parse(rule.actionConfig);
  switch (rule.action as AutomationAction) {
    case "RUN_AGENT": {
      const cfg = actionConfigSchemas.RUN_AGENT.parse(raw);
      const profile = await prisma.agentProfile.findUnique({ where: { userId: cfg.agentId }, select: { capability: true } });
      const cap = profile ? findCapability(profile.capability) : undefined;
      if (!cap) return "skipped: the agent no longer exists";
      const subjectId = cap.subjectType === "lead" ? p.leadId : cap.subjectType === "client" ? p.clientId : cap.subjectType === "project" ? p.projectId : null;
      if (cap.subjectType !== "organization" && !subjectId) return `skipped: ${cap.name} needs a ${cap.subjectType}`;
      const run = await enqueueRun({ organizationId, agentId: cfg.agentId, subjectType: cap.subjectType, subjectId: subjectId ?? null, input: { trigger: p }, requestedById: null, ruleId: rule.id });
      return `queued run ${run.id}`;
    }
    case "NOTIFY": {
      const cfg = actionConfigSchemas.NOTIFY.parse(raw);
      const recipients = await audience(cfg.to, organizationId, p);
      const href = p.leadId ? `/pipeline?lead=${p.leadId}` : p.clientId ? `/clients/${p.clientId}` : "/tasks";
      for (const userId of recipients) await notify({ userId, type: "AGENT_NOTICE", title: cfg.message, body: p.title ?? rule.name, href });
      return `notified ${recipients.length}`;
    }
    case "CREATE_TASK": {
      const cfg = actionConfigSchemas.CREATE_TASK.parse(raw);
      const assigneeId = cfg.assignTo === "owner" ? (p.ownerId ?? null) : null;
      const due = cfg.dueInDays !== undefined ? new Date(`${new Date(Date.now() + cfg.dueInDays * 86_400_000).toISOString().slice(0, 10)}T00:00:00.000Z`) : null;
      const task = await prisma.task.create({
        data: { departmentId: p.departmentId, leadId: p.leadId ?? null, clientId: p.leadId ? null : (p.clientId ?? null), projectId: p.projectId ?? null, title: cfg.title, note: `Created by the automation "${rule.name}".`, assigneeId, createdById: rule.createdById, dueAt: due, status: "NOT_STARTED", priority: "MEDIUM" },
      });
      if (assigneeId) await notify({ userId: assigneeId, type: "TASK_ASSIGNED", title: "An automation created a task for you", body: task.title, href: "/tasks" });
      return `created task ${task.id}`;
    }
    default:
      return "skipped: unknown action";
  }
}

async function audience(to: "owner" | "founders" | "managers", organizationId: string, p: EventPayload) {
  if (to === "owner") return p.ownerId ? [p.ownerId] : [];
  if (to === "founders") return (await prisma.user.findMany({ where: { organizationId, isActive: true, role: { in: storedRoleValues("FOUNDER") } }, select: { id: true } })).map((u) => u.id);
  const leads = await prisma.departmentMembership.findMany({ where: { departmentId: p.departmentId, roleInDept: "LEAD", user: { isActive: true, organizationId, role: { notIn: [...storedRoleValues("AI_AGENT"), ...storedRoleValues("CLIENT")] } } }, select: { userId: true } });
  return [...new Set(leads.map((l) => l.userId))];
}
