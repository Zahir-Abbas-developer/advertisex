#!/usr/bin/env node
/**
 * tenanttest — tenant isolation over real HTTP (CLAUDE.md §6: "tests prove
 * isolation for every entity").
 *
 * Plants a complete second organization — a department with a stage, a lead,
 * a client, a task and a team member — each carrying a unique marker, then
 * signs in as organization #1's founder, whose own filters are the widest in
 * the product (`departmentScope` returns *everything* for a founder), and
 * checks that no endpoint returns a single marker. The founder is the
 * interesting subject precisely because nothing but the tenancy wall stands
 * between them and another tenant's rows.
 *
 * Then the write side: org #1's founder addressing org #2's rows by id must
 * find nothing to change. Everything planted is removed afterwards.
 *
 *   SMOKE_BASE=http://localhost:3000 npm run tenanttest
 */

import { loadEnv, Session, waitForServer } from "./smoke.mjs";

loadEnv();

const SEED_PASSWORD = process.env.SEED_PASSWORD ?? "advertisex-change-me";
const FOUNDER = "coachd@bwm.local";
const MARK = `Tenantprobe${Date.now().toString(36)}`;

let failures = 0;
let checks = 0;

function check(ok, label, detail = "") {
  checks += 1;
  if (ok) {
    console.log(`  ✓ ${label}`);
    return true;
  }
  failures += 1;
  console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`);
  return false;
}

async function main() {
  await waitForServer();

  const { PrismaClient } = await import("@prisma/client");
  const prisma = new PrismaClient();

  const home = await prisma.organization.findUnique({ where: { slug: "advertisex" } });
  if (!home) {
    console.error("tenanttest needs organization #1 — run npm run db:seed.");
    process.exit(1);
  }
  await prisma.user.update({ where: { email: FOUNDER }, data: { mustChangePassword: false } });

  const other = await prisma.organization.create({ data: { slug: MARK.toLowerCase(), name: `${MARK} Org` } });

  try {
    const dept = await prisma.department.create({
      data: { organizationId: other.id, slug: `${MARK.toLowerCase()}-dept`, name: `${MARK} Dept`, shortLabel: `${MARK}D` },
    });
    await prisma.pipelineStage.create({
      data: { departmentId: dept.id, key: "NEW", label: `${MARK} Stage`, sortOrder: 1, kind: "OPEN" },
    });
    const person = await prisma.user.create({
      data: {
        organizationId: other.id,
        name: `${MARK} Person`,
        email: `${MARK.toLowerCase()}@tenant.example`,
        passwordHash: "x",
        role: "EMPLOYEE",
        jobTitle: `${MARK} Title`,
      },
    });
    const lead = await prisma.lead.create({
      data: { departmentId: dept.id, businessName: `${MARK} Lead`, contactName: `${MARK} Contact`, stage: "NEW", ownerId: person.id },
    });
    const client = await prisma.client.create({
      data: {
        organizationId: other.id,
        departmentId: dept.id,
        businessName: `${MARK} Client`,
        contactName: `${MARK} Contact`,
        email: `${MARK.toLowerCase()}-client@tenant.example`,
        status: "ACTIVE",
      },
    });
    const task = await prisma.task.create({
      data: { departmentId: dept.id, title: `${MARK} Task`, leadId: lead.id, assigneeId: person.id, createdById: person.id },
    });

    const founder = new Session("founder");
    await founder.signIn(FOUNDER, SEED_PASSWORD);

    console.log("\nREADS — organization #1's founder, organization #2's rows");
    for (const path of [
      "/api/leads",
      "/api/pipeline",
      "/api/clients",
      "/api/tasks",
      "/api/team",
      "/api/departments",
      "/api/departments/creatable",
      "/api/service-leads",
      `/api/search?q=${MARK}`,
      "/api/analytics",
    ]) {
      const res = await founder.fetch(path);
      const body = await res.text();
      check(res.status === 200 && !body.includes(MARK), `${path} shows nothing from organization #2`, `${res.status}${body.includes(MARK) ? " — marker found" : ""}`);
    }

    for (const [path, label] of [
      [`/api/leads/${lead.id}`, "a lead"],
      [`/api/departments/${dept.id}/form?entity=LEAD`, "a department's form"],
      [`/api/clients/${client.id}/fields`, "a client's fields"],
    ]) {
      const res = await founder.fetch(path);
      const body = await res.text();
      check(!body.includes(MARK) && res.status >= 400, `opening ${label} by id is refused`, `${res.status}`);
    }

    for (const page of ["/dashboard", "/pipeline", "/clients", "/team", "/settings/departments"]) {
      const res = await founder.fetch(page);
      const body = await res.text();
      check(!body.includes(MARK), `${page} renders nothing from organization #2`);
    }

    console.log("\nWRITES — addressing organization #2's rows by id");
    const edit = await founder.fetch(`/api/leads/${lead.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ businessName: "Overwritten across tenants" }),
    });
    check(edit.status >= 400, "editing a lead is refused", String(edit.status));
    const del = await founder.fetch(`/api/tasks/${task.id}`, { method: "DELETE" });
    check(del.status >= 400, "deleting a task is refused", String(del.status));
    const after = await prisma.lead.findUnique({ where: { id: lead.id }, select: { businessName: true } });
    check(after?.businessName === `${MARK} Lead`, "the lead is unchanged", after?.businessName);
    check(Boolean(await prisma.task.findUnique({ where: { id: task.id } })), "the task still exists");

    console.log("\nAUDIT — the data layer recorded organization #1's own write");
    const homeDept = await prisma.department.findFirst({ where: { organizationId: home.id }, select: { id: true } });
    const founderId = (await prisma.user.findUnique({ where: { email: FOUNDER }, select: { id: true } })).id;
    const own = homeDept
      ? await prisma.task.create({
          data: { departmentId: homeDept.id, title: `${MARK} Own task`, assigneeId: founderId, createdById: founderId },
          select: { id: true, title: true },
        })
      : null;
    if (own) {
      const res = await founder.fetch(`/api/tasks/${own.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: `${own.title} edited` }),
      });
      const entry = await prisma.auditLog.findFirst({
        where: { entityType: "Task", entityId: own.id, action: "RECORD_UPDATED" },
        orderBy: { createdAt: "desc" },
      });
      check(res.status === 200 && Boolean(entry), "a task edit wrote a RECORD_UPDATED entry", String(res.status));
      check(entry?.organizationId === home.id && entry?.actorType === "HUMAN", "stamped with the organization and actor type", `${entry?.organizationId} ${entry?.actorType}`);
    } else {
      console.log("  (no task in organization #1 — audit check skipped)");
    }
  } finally {
    await prisma.auditLog.deleteMany({ where: { OR: [{ summary: { contains: MARK } }, { afterJson: { contains: MARK } }, { beforeJson: { contains: MARK } }] } });
    await prisma.organization.delete({ where: { id: other.id } }).catch(() => {});
    await prisma.task.deleteMany({ where: { title: { startsWith: MARK } } });
    await prisma.lead.deleteMany({ where: { businessName: { startsWith: MARK } } });
    await prisma.client.deleteMany({ where: { businessName: { startsWith: MARK } } });
    await prisma.pipelineStage.deleteMany({ where: { label: { startsWith: MARK } } });
    await prisma.department.deleteMany({ where: { name: { startsWith: MARK } } });
    await prisma.user.deleteMany({ where: { name: { startsWith: MARK } } });
    await prisma.$disconnect();
  }

  console.log(`\n${checks} checks`);
  if (failures > 0) {
    console.error(`\n✗ ${failures} of ${checks} checks failed`);
    process.exit(1);
  }
  console.log("\n✓ no row from another organization reached this one, in either direction");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
