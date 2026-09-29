import { z } from "zod";

/**
 * Automation vocabulary (pure): the triggers, the actions, what an event
 * carries, and how a rule's conditions are matched. The engine that fires
 * rules is automations.ts.
 */

export const TRIGGERS = ["LEAD_CREATED", "LEAD_STAGE_CHANGED", "DEADLINE_NEAR", "REPORT_DUE"] as const;
export type Trigger = (typeof TRIGGERS)[number];
export const ACTIONS = ["RUN_AGENT", "NOTIFY", "CREATE_TASK"] as const;
export type AutomationAction = (typeof ACTIONS)[number];

export const TRIGGER_LABEL: Record<Trigger, string> = {
  LEAD_CREATED: "A lead is created",
  LEAD_STAGE_CHANGED: "A lead changes stage",
  DEADLINE_NEAR: "A task's deadline is near",
  REPORT_DUE: "A client's monthly report is due",
};
export const ACTION_LABEL: Record<AutomationAction, string> = {
  RUN_AGENT: "Give an AI employee the work",
  NOTIFY: "Notify people",
  CREATE_TASK: "Create a task",
};

/** What each trigger carries. Conditions may test any of these keys. */
export type EventPayload = {
  departmentId: string;
  leadId?: string;
  clientId?: string;
  projectId?: string;
  taskId?: string;
  ownerId?: string | null;
  source?: string;
  fromStage?: string | null;
  toStage?: string;
  toStageKind?: string;
  /** The LeadStageEvent row — each move is its own occasion. */
  stageEventId?: string;
  month?: string;
  title?: string;
};

export const CONDITION_KEYS = ["departmentId", "source", "toStage", "toStageKind"] as const;
const values = z.array(z.string().max(80)).max(20).optional();
export const conditionsSchema = z.object({ departmentId: values, source: values, toStage: values, toStageKind: values }).strict();
export type Conditions = z.infer<typeof conditionsSchema>;

export const actionConfigSchemas = {
  RUN_AGENT: z.object({ agentId: z.string().min(1) }).strict(),
  NOTIFY: z.object({ to: z.enum(["owner", "founders", "managers"]), message: z.string().trim().min(1).max(200) }).strict(),
  CREATE_TASK: z.object({ title: z.string().trim().min(1).max(160), dueInDays: z.number().int().min(0).max(90).optional(), assignTo: z.enum(["owner", "unassigned"]) }).strict(),
} as const;

/** A rule's conditions hold when every listed key's value is one of the allowed values. */
export function matches(conditions: Conditions, payload: EventPayload) {
  return CONDITION_KEYS.every((key) => {
    const allowed = conditions[key];
    if (!allowed || allowed.length === 0) return true;
    const value = payload[key];
    return typeof value === "string" && allowed.includes(value);
  });
}

/** The key a rule fires once per — a subject, and for recurring triggers, the occasion. */
export function subjectKey(trigger: Trigger, p: EventPayload) {
  switch (trigger) {
    case "LEAD_CREATED":
      return `lead:${p.leadId}`;
    case "LEAD_STAGE_CHANGED":
      return `stage-event:${p.stageEventId}`;
    case "DEADLINE_NEAR":
      return `task:${p.taskId}`;
    case "REPORT_DUE":
      return `client:${p.clientId}:${p.month}`;
  }
}
