/**
 * Tenant scoping as a pure function over Prisma query arguments.
 *
 * `scopeArgs(model, operation, args, organizationId)` returns the arguments
 * with the caller's organization folded in — a filter on reads, updates and
 * deletes; the key itself on creates. The Prisma extension in
 * `modules/tenancy/extension.ts` applies it to every query made inside a
 * signed-in request, so no handler can forget it: a query without tenant
 * scope is impossible by construction rather than by review (CLAUDE.md §5,
 * "a query without tenant scope is a bug").
 *
 * Kept pure so every rule is unit-tested without a database
 * (tests/tenancy-scope.test.ts).
 *
 * Two kinds of tenant-owned model:
 *
 * - **Roots** carry `organizationId` themselves.
 * - **Department-owned** rows belong to an organization through their
 *   department, and are filtered on that relation. Adding a denormalised
 *   `organizationId` to each is the Row-Level Security step (ADR-005), not
 *   needed for correctness here.
 *
 * Everything else (settings, job ledgers, a person's own notifications) is
 * either global or reached only through a scoped root.
 */

export const ORG_ROOT_MODELS = new Set(["User", "Department", "Client", "ClientAccount", "AgentGrant", "AuditLog"]);

/**
 * Roots whose rows may legitimately carry no organization: audit entries
 * written by scheduled jobs, which run without a signed-in actor. Reads admit
 * those alongside the caller's own. Safe while there is one tenant; making
 * jobs carry an organization context is Phase 2 work.
 */
const SYSTEM_ROWS_VISIBLE = new Set(["AuditLog"]);

export const DEPARTMENT_OWNED_MODELS = new Set([
  "Lead",
  "Task",
  "SalesActivity",
  "PipelineStage",
  "FieldDefinition",
  "DepartmentMembership",
]);

/** Operations whose `where` narrows which rows are read or written. */
const FILTERED = new Set([
  "findUnique",
  "findUniqueOrThrow",
  "findFirst",
  "findFirstOrThrow",
  "findMany",
  "count",
  "aggregate",
  "groupBy",
  "update",
  "updateMany",
  "delete",
  "deleteMany",
  "upsert",
]);

type Args = Record<string, unknown> | undefined;

export function isTenantModel(model: string): boolean {
  return ORG_ROOT_MODELS.has(model) || DEPARTMENT_OWNED_MODELS.has(model);
}

function filterFor(model: string, organizationId: string): Record<string, unknown> {
  if (SYSTEM_ROWS_VISIBLE.has(model)) return { OR: [{ organizationId }, { organizationId: null }] };
  return ORG_ROOT_MODELS.has(model)
    ? { organizationId }
    : { department: { organizationId } };
}

/** Folds a filter into an existing `where` without disturbing its unique key. */
function withFilter(where: unknown, filter: Record<string, unknown>): Record<string, unknown> {
  const base = (where ?? {}) as Record<string, unknown>;
  const existingAnd = base.AND;
  const and = Array.isArray(existingAnd) ? existingAnd : existingAnd ? [existingAnd] : [];
  return { ...base, AND: [...and, filter] };
}

function stamp(data: unknown, organizationId: string): unknown {
  if (Array.isArray(data)) return data.map((row) => stamp(row, organizationId));
  if (!data || typeof data !== "object") return data;
  const row = data as Record<string, unknown>;
  // A caller-supplied organizationId is overwritten, never trusted: a row is
  // always created in the organization of the person creating it. The
  // relation form (`organization: { connect }`) is rewritten the same way.
  const { organization: _ignored, ...rest } = row;
  return { ...rest, organizationId };
}

export function scopeArgs(
  model: string,
  operation: string,
  args: Args,
  organizationId: string,
): Args {
  if (!isTenantModel(model)) return args;
  const next: Record<string, unknown> = { ...(args ?? {}) };

  if (FILTERED.has(operation)) {
    next.where = withFilter(next.where, filterFor(model, organizationId));
  }

  if (ORG_ROOT_MODELS.has(model)) {
    if (operation === "create") next.data = stamp(next.data, organizationId);
    if (operation === "createMany") next.data = stamp(next.data, organizationId);
    if (operation === "upsert") next.create = stamp(next.create, organizationId);
  }

  return next;
}
