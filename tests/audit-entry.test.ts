import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { actorTypeFor, buildAuditEntry, isAudited, type Actor } from "../modules/audit/entry";

const HUMAN: Actor = { id: "u-1", type: "HUMAN", organizationId: "org-1" };

describe("audit entries written by the data layer", () => {
  it("audits business entities and ignores everything else", () => {
    assert.ok(isAudited("Lead", "update"));
    assert.ok(isAudited("Client", "create"));
    assert.ok(isAudited("User", "delete"));
    assert.equal(isAudited("Notification", "create"), false);
    assert.equal(isAudited("JobRun", "upsert"), false);
    assert.equal(isAudited("Lead", "findMany"), false);
  });

  it("records a create with its after-image and organization", () => {
    const entry = buildAuditEntry({
      model: "Client",
      operation: "create",
      args: { data: {} },
      before: null,
      result: { id: "c-1", businessName: "Bao Society", organizationId: "org-1" },
      actor: HUMAN,
    });
    assert.equal(entry?.action, "RECORD_CREATED");
    assert.equal(entry?.entityId, "c-1");
    assert.equal(entry?.organizationId, "org-1");
    assert.equal(entry?.actorId, "u-1");
    assert.equal(entry?.beforeJson, null);
    assert.deepEqual(JSON.parse(entry!.afterJson!), { id: "c-1", businessName: "Bao Society", organizationId: "org-1" });
  });

  it("records only the fields an update changed", () => {
    const entry = buildAuditEntry({
      model: "Lead",
      operation: "update",
      args: {},
      before: { id: "l-1", stage: "QUALIFIED", businessName: "Grind", updatedAt: new Date(1) },
      result: { id: "l-1", stage: "PROPOSAL", businessName: "Grind", updatedAt: new Date(2) },
      actor: HUMAN,
    });
    assert.equal(entry?.action, "RECORD_UPDATED");
    assert.deepEqual(JSON.parse(entry!.beforeJson!), { stage: "QUALIFIED" });
    assert.deepEqual(JSON.parse(entry!.afterJson!), { stage: "PROPOSAL" });
  });

  it("writes nothing for a no-op update", () => {
    const row = { id: "l-1", stage: "WON" };
    assert.equal(buildAuditEntry({ model: "Lead", operation: "update", args: {}, before: row, result: { ...row }, actor: HUMAN }), null);
  });

  it("records a delete with its before-image", () => {
    const entry = buildAuditEntry({ model: "Task", operation: "delete", args: {}, before: { id: "t-1", title: "Call" }, result: { id: "t-1", title: "Call" }, actor: HUMAN });
    assert.equal(entry?.action, "RECORD_DELETED");
    assert.deepEqual(JSON.parse(entry!.beforeJson!), { id: "t-1", title: "Call" });
    assert.equal(entry?.afterJson, null);
  });

  it("never copies a password hash into the log", () => {
    const entry = buildAuditEntry({
      model: "User",
      operation: "update",
      args: {},
      before: { id: "u-2", passwordHash: "$2a$old" },
      result: { id: "u-2", passwordHash: "$2a$new" },
      actor: HUMAN,
    });
    assert.ok(!entry?.beforeJson?.includes("$2a$"));
    assert.ok(!entry?.afterJson?.includes("$2a$"));
  });

  it("summarises bulk writes by filter and count", () => {
    const entry = buildAuditEntry({
      model: "Task",
      operation: "updateMany",
      args: { where: { leadId: "l-1" }, data: { status: "DONE" } },
      before: null,
      result: { count: 3 },
      actor: HUMAN,
    });
    assert.equal(entry?.entityId, null);
    assert.deepEqual(JSON.parse(entry!.afterJson!), { where: { leadId: "l-1" }, data: { status: "DONE" }, count: 3 });
  });

  it("types the actor from their role, and a missing session as SYSTEM", () => {
    assert.equal(actorTypeFor("AI_AGENT"), "AI");
    assert.equal(actorTypeFor("CLIENT"), "CLIENT");
    assert.equal(actorTypeFor("FOUNDER"), "HUMAN");
    assert.equal(actorTypeFor(null), "SYSTEM");
  });
});
