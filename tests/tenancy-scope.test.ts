import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { scopeArgs } from "../modules/tenancy/scope";

const ORG = "org-advertisex";

describe("tenant scoping of query arguments", () => {
  it("filters reads of a root model by organization", () => {
    const out = scopeArgs("Client", "findMany", { where: { status: "ACTIVE" } }, ORG);
    assert.deepEqual(out, { where: { status: "ACTIVE", AND: [{ organizationId: ORG }] } });
  });

  it("filters an unfiltered read — `findMany()` with no arguments is the case that leaks", () => {
    assert.deepEqual(scopeArgs("Department", "findMany", undefined, ORG), {
      where: { AND: [{ organizationId: ORG }] },
    });
  });

  it("filters department-owned rows through their department", () => {
    const out = scopeArgs("Lead", "findMany", { where: { departmentId: { in: ["d1"] } } }, ORG);
    assert.deepEqual(out, {
      where: { departmentId: { in: ["d1"] }, AND: [{ department: { organizationId: ORG } }] },
    });
  });

  it("keeps a unique key intact on single-row reads and writes", () => {
    for (const operation of ["findUnique", "update", "delete", "upsert"]) {
      const out = scopeArgs("Lead", operation, { where: { id: "lead-1" } }, ORG) as { where: Record<string, unknown> };
      assert.equal(out.where.id, "lead-1", operation);
      assert.deepEqual(out.where.AND, [{ department: { organizationId: ORG } }], operation);
    }
  });

  it("preserves an existing AND clause rather than replacing it", () => {
    const out = scopeArgs("User", "findFirst", { where: { AND: [{ isActive: true }] } }, ORG);
    assert.deepEqual(out, { where: { AND: [{ isActive: true }, { organizationId: ORG }] } });
  });

  it("filters bulk writes and aggregates", () => {
    for (const operation of ["updateMany", "deleteMany", "count", "aggregate", "groupBy"]) {
      const out = scopeArgs("Task", operation, { where: {} }, ORG) as { where: Record<string, unknown> };
      assert.deepEqual(out.where.AND, [{ department: { organizationId: ORG } }], operation);
    }
  });

  it("stamps creates of root models with the caller's organization", () => {
    assert.deepEqual(scopeArgs("Client", "create", { data: { businessName: "Bao Society" } }, ORG), {
      data: { businessName: "Bao Society", organizationId: ORG },
    });
    assert.deepEqual(scopeArgs("User", "createMany", { data: [{ email: "a" }, { email: "b" }] }, ORG), {
      data: [{ email: "a", organizationId: ORG }, { email: "b", organizationId: ORG }],
    });
  });

  it("overwrites a caller-supplied organization instead of trusting it", () => {
    const out = scopeArgs("Client", "create", { data: { organizationId: "org-elsewhere" } }, ORG) as { data: Record<string, unknown> };
    assert.equal(out.data.organizationId, ORG);
    const viaRelation = scopeArgs(
      "Department",
      "create",
      { data: { name: "x", organization: { connect: { id: "org-elsewhere" } } } },
      ORG,
    ) as { data: Record<string, unknown> };
    assert.equal(viaRelation.data.organizationId, ORG);
    assert.equal(viaRelation.data.organization, undefined);
  });

  it("stamps the create branch of an upsert and filters its lookup", () => {
    const out = scopeArgs("ClientAccount", "upsert", { where: { id: "a" }, create: { name: "n" }, update: {} }, ORG) as Record<string, Record<string, unknown>>;
    assert.equal(out.create.organizationId, ORG);
    assert.deepEqual(out.where.AND, [{ organizationId: ORG }]);
  });

  it("leaves models outside tenancy untouched", () => {
    const args = { where: { id: "singleton" } };
    assert.equal(scopeArgs("Settings", "findUnique", args, ORG), args);
    assert.equal(scopeArgs("JobRun", "upsert", args, ORG), args);
  });

  it("filters stage history through its lead's department", () => {
    const out = scopeArgs("LeadStageEvent", "findMany", { where: { toStage: "WON" } }, ORG) as { where: Record<string, unknown> };
    assert.deepEqual(out.where.AND, [{ lead: { department: { organizationId: ORG } } }]);
  });

  it("scopes every Phase 4 root by organization and stamps its creates", () => {
    for (const model of ["Project", "ServiceCatalog", "ClientService", "Contract", "ClientCredential", "ClientNote"]) {
      const read = scopeArgs(model, "findMany", undefined, ORG) as { where: Record<string, unknown> };
      assert.deepEqual(read.where.AND, [{ organizationId: ORG }], model);
      const made = scopeArgs(model, "create", { data: { organizationId: "org-elsewhere" } }, ORG) as { data: Record<string, unknown> };
      assert.equal(made.data.organizationId, ORG, model);
    }
  });

  it("filters project-owned rows through their project", () => {
    for (const model of ["ProjectService", "ProjectMember", "ProjectSkill", "ProjectStage", "ProjectMilestone", "ProjectComment"]) {
      for (const operation of ["findMany", "findUnique", "update", "deleteMany", "count"]) {
        const out = scopeArgs(model, operation, { where: {} }, ORG) as { where: Record<string, unknown> };
        assert.deepEqual(out.where.AND, [{ project: { organizationId: ORG } }], `${model}.${operation}`);
      }
    }
  });

  it("filters catalog-owned rows through their service", () => {
    for (const model of ["ServiceStageTemplate", "ServiceSkill"]) {
      const out = scopeArgs(model, "findMany", { where: {} }, ORG) as { where: Record<string, unknown> };
      assert.deepEqual(out.where.AND, [{ service: { organizationId: ORG } }], model);
    }
  });
});
