import type { Action, Resource } from "@/config/permissions";
import type { Capability } from "@/modules/ai/agents/capability";

/**
 * The permission each agent tool needs (pure — the seed and the hire flow
 * read it too). An agent holds a grant per `resource:action`; giving it a
 * capability means granting exactly what that capability's tools need.
 */
export const TOOL_GRANTS = {
  "leads.read": ["lead", "read"],
  "leads.addNote": ["activity", "create"],
  "leads.tag": ["lead", "update"],
  "leads.proposeOutcome": ["lead", "update"],
  "web.fetch": ["lead", "read"],
  "tasks.create": ["task", "create"],
  "projects.read": ["project", "read"],
  "reports.draft": ["clientReport", "create"],
  "reports.proposePublish": ["clientReport", "update"],
  "notify.team": ["notification", "create"],
  "messages.proposeToClient": ["message", "create"],
  "invoices.propose": ["invoice", "create"],
  "pipeline.snapshot": ["lead", "read"],
} as const satisfies Record<string, readonly [Resource, Action]>;

export type ToolGrantName = keyof typeof TOOL_GRANTS;

/** The distinct grants a capability needs, as [resource, action] pairs. */
export function grantsFor(cap: Pick<Capability, "tools">): [Resource, Action][] {
  const seen = new Map<string, [Resource, Action]>();
  for (const tool of cap.tools) {
    const [resource, action] = TOOL_GRANTS[tool as ToolGrantName];
    seen.set(`${resource}:${action}`, [resource, action]);
  }
  return [...seen.values()];
}
