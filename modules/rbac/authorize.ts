import {
  scopeFor,
  type Action,
  type Resource,
  type Role,
  type Scope,
} from "@/config/permissions";

/**
 * `authorize(principal, action, resource, target?)` — the one answer to "may
 * this person do this" (CLAUDE.md §5).
 *
 * Pure: no database, no session. Everything it needs arrives in the
 * principal (resolved per request from the database by
 * `modules/rbac/server.ts`) and the target (the row being touched). That
 * makes every rule unit-testable, and it is: tests/authorize.test.ts.
 *
 * Two ways to call it:
 *
 * - **Without a target** — the role-level gate at the top of a route
 *   handler: "may a MANAGER update leads *at all*?" A `grant` scope still
 *   needs the grant; every other scope passes, because which rows are in
 *   scope is decided when the row (or the list query) is known.
 * - **With a target** — the row-level decision: this lead, this client.
 *
 * Every path that is not an explicit allow is a refusal.
 */

export type Principal = {
  id: string;
  role: Role;
  /** Null only for accounts that predate tenancy and were never backfilled. */
  organizationId: string | null;
  departmentIds: readonly string[];
  /** CLIENT logins only. */
  clientAccountId: string | null;
  /** Clients this person owns or has work on — the `assigned` scope. */
  assignedClientIds: readonly string[];
  /** Projects this person is a member of or owns a milestone in (Phase 4). */
  assignedProjectIds: readonly string[];
  /** AI_AGENT only: "resource:action" strings from AgentGrant rows. */
  grants: readonly string[];
};

/** What is known about the row being touched. Omit what does not apply. */
export type Target = {
  organizationId?: string | null;
  departmentId?: string | null;
  /** The person a row *is* or belongs to — a profile, a notification. */
  ownerId?: string | null;
  /** The person responsible for the row. */
  assigneeId?: string | null;
  /** For rows attached to a client (the client itself, or its tasks). */
  clientId?: string | null;
  /** For a project and the rows inside it (Phase 4). */
  projectId?: string | null;
  clientAccountId?: string | null;
};

export type Decision =
  | { allowed: true; scope: Scope }
  | { allowed: false; reason: string };

const deny = (reason: string): Decision => ({ allowed: false, reason });

export const grantKey = (resource: Resource, action: Action) => `${resource}:${action}`;

export function authorize(
  principal: Principal,
  action: Action,
  resource: Resource,
  target?: Target,
): Decision {
  const scope = scopeFor(principal.role, action, resource);
  if (!scope) return deny(`${principal.role} may not ${action} ${resource}`);

  // A grant is checked with or without a target: without the grant row the
  // role holds nothing on this resource.
  if (scope === "grant" && !principal.grants.includes(grantKey(resource, action))) {
    return deny(`no grant for ${grantKey(resource, action)}`);
  }

  if (!target) return { allowed: true, scope };

  // Organization isolation sits above every scope, including "all".
  if (target.organizationId !== undefined) {
    if (!principal.organizationId || target.organizationId !== principal.organizationId) {
      return deny("outside the principal's organization");
    }
  }

  switch (scope) {
    case "all":
    case "grant":
      return { allowed: true, scope };

    case "department":
      return target.departmentId && principal.departmentIds.includes(target.departmentId)
        ? { allowed: true, scope }
        : deny("outside the principal's departments");

    case "assigned": {
      const mine =
        (target.assigneeId != null && target.assigneeId === principal.id) ||
        (target.ownerId != null && target.ownerId === principal.id) ||
        (target.clientId != null && principal.assignedClientIds.includes(target.clientId)) ||
        (target.projectId != null && principal.assignedProjectIds.includes(target.projectId));
      return mine ? { allowed: true, scope } : deny("not assigned to the principal");
    }

    case "own":
      return target.ownerId != null && target.ownerId === principal.id
        ? { allowed: true, scope }
        : deny("not the principal's own");

    case "client-own":
      return principal.clientAccountId != null &&
        target.clientAccountId === principal.clientAccountId
        ? { allowed: true, scope }
        : deny("outside the principal's client account");
  }
}
