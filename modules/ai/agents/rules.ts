import "server-only";

import { z } from "zod";

import { prisma } from "@/lib/prisma";
import { storedRoleValues } from "@/config/permissions";
import type { Principal } from "@/modules/rbac/authorize";
import { capability as findCapability } from "@/modules/ai/agents/registry";
import { ACTIONS, ACTION_LABEL, TRIGGERS, TRIGGER_LABEL, actionConfigSchemas, conditionsSchema, type AutomationAction, type Trigger } from "@/modules/ai/agents/triggers";
import { RunError } from "@/modules/ai/agents/queue";

/** The founder's automation rules: list, create, edit, delete — validated against this organization. */

export const ruleInputSchema = z
  .object({
    name: z.string().trim().min(1, "Name the rule").max(80),
    enabled: z.boolean().default(true),
    trigger: z.enum(TRIGGERS),
    conditions: conditionsSchema.default({}),
    action: z.enum(ACTIONS),
    actionConfig: z.record(z.unknown()),
  })
  .strict();
export type RuleInput = z.infer<typeof ruleInputSchema>;

/** Which subjects a trigger carries — a RUN_AGENT rule's agent must work on one of them. */
const TRIGGER_SUBJECTS: Record<Trigger, string[]> = {
  LEAD_CREATED: ["lead"],
  LEAD_STAGE_CHANGED: ["lead"],
  DEADLINE_NEAR: ["lead", "client", "project"],
  REPORT_DUE: ["client"],
};

async function validate(principal: Principal, input: RuleInput) {
  const organizationId = principal.organizationId!;
  const config = actionConfigSchemas[input.action as AutomationAction].safeParse(input.actionConfig);
  if (!config.success) throw new RunError("That action isn't set up completely");
  if (input.action === "RUN_AGENT") {
    const agentId = (config.data as { agentId: string }).agentId;
    const agent = await prisma.user.findFirst({ where: { id: agentId, organizationId, role: { in: storedRoleValues("AI_AGENT") } }, select: { agentProfile: { select: { capability: true } } } });
    const cap = agent?.agentProfile ? findCapability(agent.agentProfile.capability) : null;
    if (!cap) throw new RunError("Pick an AI employee");
    if (cap.subjectType !== "organization" && !TRIGGER_SUBJECTS[input.trigger].includes(cap.subjectType)) throw new RunError(`${cap.name} works on a ${cap.subjectType}; this trigger doesn't give it one`);
  }
  const departments = input.conditions.departmentId ?? [];
  if (departments.length) {
    const found = await prisma.department.count({ where: { id: { in: departments }, organizationId } });
    if (found !== departments.length) throw new RunError("Pick departments from this organization");
  }
  return { ...input, actionConfig: config.data };
}

export async function listRules(principal: Principal) {
  const rules = await prisma.automationRule.findMany({ where: { organizationId: principal.organizationId ?? "__none__" }, orderBy: { createdAt: "asc" }, include: { firings: { orderBy: { createdAt: "desc" }, take: 3, select: { outcome: true, createdAt: true } } } });
  return rules.map((r) => ({
    id: r.id,
    name: r.name,
    enabled: r.enabled,
    trigger: r.trigger as Trigger,
    triggerLabel: TRIGGER_LABEL[r.trigger as Trigger] ?? r.trigger,
    conditions: JSON.parse(r.conditions) as Record<string, string[]>,
    action: r.action as AutomationAction,
    actionLabel: ACTION_LABEL[r.action as AutomationAction] ?? r.action,
    actionConfig: JSON.parse(r.actionConfig) as Record<string, unknown>,
    fireCount: r.fireCount,
    lastFiredAt: r.lastFiredAt?.toISOString() ?? null,
    recent: r.firings.map((f) => ({ outcome: f.outcome, at: f.createdAt.toISOString() })),
  }));
}

export type RuleRow = Awaited<ReturnType<typeof listRules>>[number];

export async function createRule(principal: Principal, input: RuleInput) {
  const v = await validate(principal, input);
  return prisma.automationRule.create({ data: { organizationId: principal.organizationId!, name: v.name, enabled: v.enabled, trigger: v.trigger, conditions: JSON.stringify(v.conditions), action: v.action, actionConfig: JSON.stringify(v.actionConfig), createdById: principal.id } });
}

async function ruleInOrg(principal: Principal, id: string) {
  const rule = await prisma.automationRule.findFirst({ where: { id, organizationId: principal.organizationId ?? "__none__" } });
  if (!rule) throw new RunError("No such rule", 404);
  return rule;
}

export async function updateRule(principal: Principal, id: string, input: RuleInput) {
  await ruleInOrg(principal, id);
  const v = await validate(principal, input);
  return prisma.automationRule.update({ where: { id }, data: { name: v.name, enabled: v.enabled, trigger: v.trigger, conditions: JSON.stringify(v.conditions), action: v.action, actionConfig: JSON.stringify(v.actionConfig) } });
}

export async function setRuleEnabled(principal: Principal, id: string, enabled: boolean) {
  await ruleInOrg(principal, id);
  return prisma.automationRule.update({ where: { id }, data: { enabled } });
}

export async function deleteRule(principal: Principal, id: string) {
  await ruleInOrg(principal, id);
  await prisma.automationRule.delete({ where: { id } });
}
