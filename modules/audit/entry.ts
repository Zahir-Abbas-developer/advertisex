/**
 * What the data layer writes to the audit log for one mutation — pure, so the
 * rules are unit-tested (tests/audit-entry.test.ts).
 *
 * CLAUDE.md §5: every create/update/delete of a business entity writes
 * `AuditLog { actorId, actorType, organizationId, entity, entityId, action,
 * diff, occurredAt }`. Here `diff` is the pair `beforeJson`/`afterJson`
 * (reduced to the fields that changed on an update) and `occurredAt` is the
 * row's `createdAt`.
 *
 * These automatic entries sit beside the hand-written ones in `lib/audit.ts`.
 * Those say *why* in a sentence a person can read ("Approved 'Campaign
 * launch'"); these guarantee that nothing changed without a trace, even in a
 * code path nobody remembered to instrument.
 */

/** Business entities — every mutation of these is recorded. */
export const AUDITED_MODELS = new Set([
  "Organization",
  "ClientAccount",
  "User",
  "AgentGrant",
  "Department",
  "DepartmentMembership",
  "PipelineStage",
  "FieldDefinition",
  "Client",
  "Lead",
  "Task",
  "Project",
  "Milestone",
  "ServiceCatalog",
  "Settings",
  // Phase 2 — the team operating system. Attendance and profile changes are
  // audited so the employee activity feed can be sourced from this log.
  "Skill",
  "UserSkill",
  "WorkSchedule",
  "TaskChecklistItem",
  "TaskComment",
  "File",
  "AttendanceDay",
  "BreakSession",
  // Phase 4 — client management and projects. The project activity feed and
  // the credential access trail are read from here.
  "ClientService",
  "Contract",
  "ClientCredential",
  "ClientNote",
  "ServiceStageTemplate",
  "ProjectService",
  "ProjectMember",
  "ProjectSkill",
  "ProjectStage",
  "ProjectMilestone",
  "ProjectComment",
  // Phase 5 — every recommendation decision (accept, override, dismiss) and
  // every reassignment suggestion is on the record.
  "AssignmentRecommendation",
  "ReassignmentSuggestion",
  // Phase 6 — the founder's full visibility over client communication and
  // what is shared with clients.
  "ClientInvite",
  "ProjectUpdate",
  "ClientReport",
  "MessageThread",
  "Message",
  // Phase 7 — every billing mutation.
  "Invoice",
  "InvoiceLine",
  "Payment",
  // Phase 9 — agent setup, approval decisions, automation rules. (Runs and
  // steps are themselves the agent's log; each tool call also writes an
  // AGENT_ACTION entry with its inputs and outputs.)
  "AgentProfile",
  "ApprovalRequest",
  "AutomationRule",
  // Phase 8 — announcements, client metrics (manual entry and syncs), connections.
  "Announcement",
  "MetricValue",
  "IntegrationConnection",
]);

export const RECORD_ACTIONS = {
  create: "RECORD_CREATED",
  update: "RECORD_UPDATED",
  delete: "RECORD_DELETED",
} as const;

const OPERATION_KIND: Record<string, keyof typeof RECORD_ACTIONS> = {
  create: "create",
  createMany: "create",
  update: "update",
  updateMany: "update",
  upsert: "update",
  delete: "delete",
  deleteMany: "delete",
};

/** Never copied into the audit log, whatever the model. */
/** `secret` is a vault credential's sealed value: even ciphertext stays out of the log. */
const REDACTED = new Set(["passwordHash", "secret", "tokenHash"]);

export type ActorType = "HUMAN" | "AI" | "CLIENT" | "SYSTEM";

export type Actor = {
  id: string | null;
  type: ActorType;
  organizationId: string | null;
};

export type AuditEntry = {
  actorId: string | null;
  actorType: ActorType;
  organizationId: string | null;
  action: (typeof RECORD_ACTIONS)[keyof typeof RECORD_ACTIONS];
  entityType: string;
  entityId: string | null;
  summary: string;
  beforeJson: string | null;
  afterJson: string | null;
};

export function actorTypeFor(role: string | null | undefined): ActorType {
  if (role === "AI_AGENT") return "AI";
  if (role === "CLIENT") return "CLIENT";
  if (role) return "HUMAN";
  return "SYSTEM";
}

export function isAudited(model: string | undefined, operation: string): boolean {
  return Boolean(model && AUDITED_MODELS.has(model) && OPERATION_KIND[operation]);
}

function redact(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const out: Record<string, unknown> = {};
  for (const [key, field] of Object.entries(value as Record<string, unknown>)) {
    if (REDACTED.has(key)) {
      out[key] = "[redacted]";
    } else if (field instanceof Date) {
      out[key] = field.toISOString();
    } else if (field === null || typeof field !== "object") {
      out[key] = field;
    }
    // Nested objects (relations, nested writes) are not recorded: each nested
    // model is audited on its own when it is itself a business entity.
  }
  return out;
}

/** Only the fields whose value changed, as matching before/after objects. */
function changed(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): [Record<string, unknown>, Record<string, unknown>] {
  const b: Record<string, unknown> = {};
  const a: Record<string, unknown> = {};
  for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
    if (key === "updatedAt") continue;
    if (JSON.stringify(before[key]) !== JSON.stringify(after[key])) {
      b[key] = before[key];
      a[key] = after[key];
    }
  }
  return [b, a];
}

export function buildAuditEntry(input: {
  model: string;
  operation: string;
  args: Record<string, unknown> | undefined;
  before: unknown;
  result: unknown;
  actor: Actor;
}): AuditEntry | null {
  const kind = OPERATION_KIND[input.operation];
  if (!kind || !AUDITED_MODELS.has(input.model)) return null;

  const bulk = input.operation.endsWith("Many");
  const before = redact(input.before);
  const after = kind === "delete" ? null : redact(input.result);

  let beforeJson: string | null = null;
  let afterJson: string | null = null;

  if (bulk) {
    // No per-row snapshot for bulk writes: record what was asked and how many
    // rows it touched.
    const count = (input.result as { count?: number } | null)?.count ?? null;
    // Like a no-op update: a bulk write that touched nothing leaves no trace.
    if (count === 0) return null;
    afterJson = JSON.stringify({
      where: redact(input.args?.where) ?? null,
      data: redact(input.args?.data) ?? null,
      count,
    });
  } else if (kind === "update" && before && after) {
    const [b, a] = changed(before, after);
    if (Object.keys(a).length === 0) return null; // a no-op update leaves no trace
    beforeJson = JSON.stringify(b);
    afterJson = JSON.stringify(a);
  } else {
    beforeJson = before ? JSON.stringify(before) : null;
    afterJson = after ? JSON.stringify(after) : null;
  }

  const row = (after ?? before ?? {}) as Record<string, unknown>;
  const entityId = bulk ? null : typeof row.id === "string" ? row.id : null;
  const organizationId =
    typeof row.organizationId === "string" ? row.organizationId : input.actor.organizationId;

  return {
    actorId: input.actor.id,
    actorType: input.actor.type,
    organizationId,
    action: RECORD_ACTIONS[kind],
    entityType: input.model,
    entityId,
    // "Lead updated", "Task deleted", "Client updateMany (bulk)".
    summary: bulk ? `${input.model} ${input.operation} (bulk)` : `${input.model} ${kind}d`,
    beforeJson,
    afterJson,
  };
}
