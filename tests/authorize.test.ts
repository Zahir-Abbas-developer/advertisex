import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  ACTIONS,
  LEGACY_ROLES,
  PERMISSIONS,
  RESOURCES,
  ROLES,
  normalizeRole,
  storedRoleValues,
  type Role,
} from "../config/permissions";
import { authorize, type Principal } from "../modules/rbac/authorize";

/**
 * The Phase 1 acceptance tests for authorization (docs/PHASES.md, scope 6):
 * a CLIENT cannot read another client's data; an EMPLOYEE cannot read
 * unassigned client data; MANAGER scope holds; FOUNDER has full access; an
 * AI_AGENT is restricted to explicit grants. Plus the property the founder
 * asked for explicitly: anything unrecognised is denied, never allowed.
 */

const ORG = "org-advertisex";
const OTHER_ORG = "org-elsewhere";
const AUDIT = "dept-appetite-audit";
const SPRINT = "dept-growth-sprint";
const STUDIO = "dept-creative-studio";

function principal(role: Role, extra: Partial<Principal> = {}): Principal {
  return {
    id: `user-${role.toLowerCase()}`,
    role,
    organizationId: ORG,
    departmentIds: [],
    clientAccountId: null,
    assignedClientIds: [],
    grants: [],
    ...extra,
  };
}

const allowed = (d: ReturnType<typeof authorize>) => d.allowed;

describe("role vocabulary", () => {
  it("maps each legacy role to its new name", () => {
    assert.equal(normalizeRole("ADMIN"), "FOUNDER");
    assert.equal(normalizeRole("SUPPORT_ADMIN"), "MANAGER");
    assert.equal(normalizeRole("MEMBER"), "EMPLOYEE");
  });

  it("passes the new names through unchanged", () => {
    for (const role of ROLES) assert.equal(normalizeRole(role), role);
  });

  it("denies (returns null for) anything it does not recognise", () => {
    for (const raw of ["ROOT", "admin", "Founder", "", " ADMIN", "SERVICE_LEAD", undefined, null, 1, {}]) {
      assert.equal(normalizeRole(raw), null, `expected null for ${JSON.stringify(raw)}`);
    }
  });

  it("matches every stored spelling in database filters", () => {
    assert.deepEqual(storedRoleValues("EMPLOYEE").sort(), ["EMPLOYEE", "MEMBER"]);
    assert.deepEqual(storedRoleValues("FOUNDER").sort(), ["ADMIN", "FOUNDER"]);
    assert.deepEqual(storedRoleValues("CLIENT"), ["CLIENT"]);
  });

  it("never maps a legacy string to a role outside the model", () => {
    for (const mapped of Object.values(LEGACY_ROLES)) assert.ok(ROLES.includes(mapped));
  });
});

describe("the matrix itself", () => {
  it("gives CLIENT nothing wider than its own account or its own self", () => {
    for (const resource of RESOURCES) {
      for (const action of ACTIONS) {
        const scope = PERMISSIONS[resource]?.[action]?.CLIENT;
        if (scope) assert.ok(scope === "client-own" || scope === "own", `${resource}:${action} gives CLIENT ${scope}`);
      }
    }
  });

  it("gives AI_AGENT only grant-gated cells", () => {
    for (const resource of RESOURCES) {
      for (const action of ACTIONS) {
        const scope = PERMISSIONS[resource]?.[action]?.AI_AGENT;
        if (scope) assert.equal(scope, "grant", `${resource}:${action} gives AI_AGENT ${scope}`);
      }
    }
  });

  it("keeps founder-only configuration founder-only", () => {
    for (const action of ACTIONS) {
      const row = PERMISSIONS.admin[action] ?? {};
      assert.deepEqual(Object.keys(row), ["FOUNDER"], `admin:${action}`);
    }
  });
});

describe("CLIENT cannot read another client's data", () => {
  const client = principal("CLIENT", { clientAccountId: "acct-osteria" });

  it("reads its own account's client record", () => {
    assert.ok(allowed(authorize(client, "read", "client", { organizationId: ORG, clientAccountId: "acct-osteria" })));
  });

  it("is refused another account's client record", () => {
    assert.equal(allowed(authorize(client, "read", "client", { organizationId: ORG, clientAccountId: "acct-bao" })), false);
  });

  it("is refused a record with no account at all", () => {
    assert.equal(allowed(authorize(client, "read", "client", { organizationId: ORG, clientAccountId: null })), false);
  });

  it("is refused every client record when its own account is unset", () => {
    const orphan = principal("CLIENT", { clientAccountId: null });
    assert.equal(allowed(authorize(orphan, "read", "client", { organizationId: ORG, clientAccountId: null })), false);
  });

  it("is refused the whole team product — leads, tasks, admin, ops, analytics", () => {
    for (const resource of ["lead", "task", "admin", "ops", "analytics", "department", "delivery", "attendance"] as const) {
      assert.equal(allowed(authorize(client, "read", resource)), false, resource);
    }
  });

  it("may not write to its client record", () => {
    assert.equal(allowed(authorize(client, "update", "client", { organizationId: ORG, clientAccountId: "acct-osteria" })), false);
  });
});

describe("EMPLOYEE cannot read unassigned client data", () => {
  const employee = principal("EMPLOYEE", {
    departmentIds: [SPRINT],
    assignedClientIds: ["client-worked-on"],
  });

  it("reads a client they own", () => {
    assert.ok(allowed(authorize(employee, "read", "client", { organizationId: ORG, departmentId: SPRINT, assigneeId: employee.id })));
  });

  it("reads a client they have work on", () => {
    assert.ok(allowed(authorize(employee, "read", "client", { organizationId: ORG, departmentId: SPRINT, clientId: "client-worked-on" })));
  });

  it("is refused an unassigned client — even inside their own department", () => {
    assert.equal(
      allowed(authorize(employee, "read", "client", { organizationId: ORG, departmentId: SPRINT, assigneeId: "someone-else", clientId: "client-other" })),
      false,
    );
  });

  it("works leads inside their departments and nowhere else", () => {
    assert.ok(allowed(authorize(employee, "update", "lead", { organizationId: ORG, departmentId: SPRINT })));
    assert.equal(allowed(authorize(employee, "read", "lead", { organizationId: ORG, departmentId: STUDIO })), false);
  });

  it("is refused founder configuration and ops tooling", () => {
    assert.equal(allowed(authorize(employee, "manage", "admin")), false);
    assert.equal(allowed(authorize(employee, "read", "ops")), false);
  });

  it("sees only their own attendance", () => {
    assert.ok(allowed(authorize(employee, "read", "attendance", { ownerId: employee.id })));
    assert.equal(allowed(authorize(employee, "read", "attendance", { ownerId: "someone-else" })), false);
  });
});

describe("MANAGER scope holds", () => {
  const manager = principal("MANAGER", { departmentIds: [AUDIT, SPRINT] });

  it("works leads and clients inside their departments", () => {
    assert.ok(allowed(authorize(manager, "update", "lead", { organizationId: ORG, departmentId: AUDIT })));
    assert.ok(allowed(authorize(manager, "read", "client", { organizationId: ORG, departmentId: SPRINT })));
  });

  it("is refused leads and clients outside their departments", () => {
    assert.equal(allowed(authorize(manager, "read", "lead", { organizationId: ORG, departmentId: STUDIO })), false);
    assert.equal(allowed(authorize(manager, "read", "client", { organizationId: ORG, departmentId: STUDIO })), false);
  });

  it("is refused a row with no department rather than treating it as everyone's", () => {
    assert.equal(allowed(authorize(manager, "read", "lead", { organizationId: ORG, departmentId: null })), false);
  });

  it("reads ops tooling but not founder configuration or money", () => {
    assert.ok(allowed(authorize(manager, "read", "ops")));
    for (const action of ACTIONS) assert.equal(allowed(authorize(manager, action, "admin")), false, `admin:${action}`);
  });

  it("may not delete a client", () => {
    assert.equal(allowed(authorize(manager, "delete", "client", { organizationId: ORG, departmentId: AUDIT })), false);
  });
});

describe("FOUNDER has full access", () => {
  const founder = principal("FOUNDER");

  it("is allowed every cell the matrix grants the founder, on any row in the organization", () => {
    for (const resource of RESOURCES) {
      for (const action of ACTIONS) {
        if (!PERMISSIONS[resource]?.[action]?.FOUNDER) continue;
        const decision = authorize(founder, action, resource, {
          organizationId: ORG,
          departmentId: STUDIO,
          ownerId: founder.id,
          assigneeId: "someone-else",
        });
        assert.ok(decision.allowed, `${resource}:${action}`);
      }
    }
  });

  it("holds every business resource org-wide", () => {
    for (const resource of ["admin", "ops", "lead", "client", "clientAccount", "task", "department", "analytics"] as const) {
      assert.equal(PERMISSIONS[resource].read?.FOUNDER, "all", resource);
    }
  });

  it("is still refused a row from another organization", () => {
    assert.equal(allowed(authorize(founder, "read", "client", { organizationId: OTHER_ORG })), false);
  });
});

describe("AI_AGENT is restricted to explicit grants", () => {
  const bare = principal("AI_AGENT");
  const granted = principal("AI_AGENT", { departmentIds: [SPRINT], grants: ["lead:read"] });

  it("holds nothing without a grant — not even reads", () => {
    for (const resource of RESOURCES) {
      for (const action of ACTIONS) {
        assert.equal(allowed(authorize(bare, action, resource)), false, `${resource}:${action}`);
      }
    }
  });

  it("gets exactly the granted action and nothing adjacent", () => {
    assert.ok(allowed(authorize(granted, "read", "lead", { organizationId: ORG, departmentId: STUDIO })));
    assert.equal(allowed(authorize(granted, "update", "lead", { organizationId: ORG })), false);
    assert.equal(allowed(authorize(granted, "delete", "lead", { organizationId: ORG })), false);
    assert.equal(allowed(authorize(granted, "read", "client", { organizationId: ORG })), false);
  });

  it("cannot be granted into cells the matrix never offers an agent", () => {
    const overreach = principal("AI_AGENT", { grants: ["admin:manage", "ops:read", "client:delete"] });
    assert.equal(allowed(authorize(overreach, "manage", "admin")), false);
    assert.equal(allowed(authorize(overreach, "read", "ops")), false);
    assert.equal(allowed(authorize(overreach, "delete", "client", { organizationId: ORG })), false);
  });

  it("is still held to its organization", () => {
    assert.equal(allowed(authorize(granted, "read", "lead", { organizationId: OTHER_ORG })), false);
  });
});

describe("organization isolation", () => {
  it("refuses a principal with no organization any organization-owned row", () => {
    const stray = principal("FOUNDER", { organizationId: null });
    assert.equal(allowed(authorize(stray, "read", "lead", { organizationId: ORG })), false);
  });
});

describe("Phase 2 — employees, skills, attendance", () => {
  const founder = principal("FOUNDER");
  const manager = principal("MANAGER", { departmentIds: [SPRINT] });
  const employee = principal("EMPLOYEE", { departmentIds: [SPRINT] });
  const client = principal("CLIENT", { clientAccountId: "acct-osteria" });
  const agent = principal("AI_AGENT", { grants: ["lead:read"] });

  it("lets an employee read their own profile and nobody else's", () => {
    assert.ok(allowed(authorize(employee, "read", "employee", { organizationId: ORG, ownerId: employee.id })));
    assert.equal(allowed(authorize(employee, "read", "employee", { organizationId: ORG, ownerId: "someone-else" })), false);
  });

  it("scopes a manager's directory to their departments", () => {
    assert.ok(allowed(authorize(manager, "read", "employee", { organizationId: ORG, departmentId: SPRINT })));
    assert.equal(allowed(authorize(manager, "read", "employee", { organizationId: ORG, departmentId: STUDIO })), false);
  });

  it("keeps profile edits, schedules and the skills catalog with the founder", () => {
    for (const p of [manager, employee]) {
      assert.equal(allowed(authorize(p, "update", "employee")), false);
      assert.equal(allowed(authorize(p, "manage", "attendance")), false);
      assert.equal(allowed(authorize(p, "create", "skill")), false);
    }
    assert.ok(allowed(authorize(founder, "manage", "attendance")));
    assert.ok(allowed(authorize(founder, "create", "skill")));
  });

  it("lets everyone clock themselves in, and nobody clock in for someone else", () => {
    for (const p of [founder, manager, employee]) {
      assert.ok(allowed(authorize(p, "create", "attendance", { ownerId: p.id })));
      assert.equal(allowed(authorize(p, "create", "attendance", { ownerId: "someone-else" })), false);
    }
  });

  it("gives clients and AI agents no attendance and no directory", () => {
    for (const p of [client, agent]) {
      assert.equal(allowed(authorize(p, "create", "attendance")), false);
      assert.equal(allowed(authorize(p, "read", "employee")), false);
    }
  });
});
