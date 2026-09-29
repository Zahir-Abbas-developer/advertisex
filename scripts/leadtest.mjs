#!/usr/bin/env node
/**
 * leadtest — the Phase 3 acceptance for the pipeline, over real HTTP:
 *
 *   "Lead lifecycle works end-to-end including conversion; no duplicate data
 *    entry anywhere." · "Kanban stays fast with 1,000+ leads."
 *
 * Creates a lead with every Phase 3 field, proves a duplicate is caught,
 * walks it through the standard stages (history recorded, a loss needs a
 * reason), converts it in one action and checks every piece that must exist
 * afterwards — and that a failed conversion leaves nothing behind. Then CSV
 * export and import (with preview and duplicate detection), saved views, the
 * boundaries an employee meets, and the board's speed with 1,200 extra leads.
 * Everything created is removed.
 *
 *   SMOKE_BASE=http://localhost:3000 npm run leadtest
 */

import { loadEnv, Session, waitForServer } from "./smoke.mjs";

loadEnv();

const SEED_PASSWORD = process.env.SEED_PASSWORD ?? "advertisex-change-me";
const FOUNDER = "coachd@bwm.local";
const EMPLOYEE = "tayyaba@bwm.local";
const MARK = `Leadtest${Date.now().toString(36)}`;
const BULK = 1_200;

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
const json = async (res) => res.json().catch(() => ({}));
const send = (s, method, path, body) =>
  s.fetch(path, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

async function main() {
  await waitForServer();
  const { PrismaClient } = await import("@prisma/client");
  const prisma = new PrismaClient();
  await prisma.user.updateMany({ where: { email: { in: [FOUNDER, EMPLOYEE] } }, data: { mustChangePassword: false } });

  const dept = await prisma.department.findFirst({ where: { stages: { some: { key: "NEGOTIATION" } } }, select: { id: true, shortLabel: true } });
  const service = await prisma.serviceCatalog.findFirst({ where: { isActive: true }, select: { id: true, name: true } });
  if (!dept) {
    console.error("leadtest needs a department on the standard pipeline — run npm run db:reset.");
    process.exit(1);
  }

  const founder = new Session("founder");
  await founder.signIn(FOUNDER, SEED_PASSWORD);
  const employee = new Session("employee");
  await employee.signIn(EMPLOYEE, SEED_PASSWORD);

  const cleanup = { leadIds: [], clientIds: [], accountIds: [], userEmails: [] };

  try {
    // ------------------------------------------------------------ create
    console.log("\nCREATE");
    // Answer the department's own required questions, whatever their type.
    const form = await json(await founder.fetch(`/api/departments/${dept.id}/form?entity=LEAD`));
    const fieldValues = {};
    for (const field of form.fields ?? []) {
      if (!field.required) continue;
      fieldValues[field.key] =
        field.type === "SELECT" || field.type === "MULTISELECT" ? field.options[0] ?? "" :
        field.type === "NUMBER" || field.type === "CURRENCY" ? "1500" :
        field.type === "DATE" ? new Date().toISOString().slice(0, 10) : `leadtest-${field.key}`;
    }
    const payload = {
      fieldValues,
      departmentId: dept.id,
      businessName: `${MARK} Bistro`,
      contactName: "Test Owner",
      email: `${MARK.toLowerCase()}@bistro.example`,
      phone: "+1 555 0199",
      website: "bistro.example",
      location: "Brooklyn, NY",
      industry: "Fine dining",
      source: "OTHER",
      sourceDetail: "Food expo 2026",
      tags: ["Brunch", "VIP"],
      dealValue: 4800,
      estimatedMonthlyValue: 1600,
      notes: "Two sites, strong weekend trade.",
    };
    const created = await send(founder, "POST", "/api/leads", payload);
    const createdBody = await json(created);
    const leadId = createdBody.lead?.id;
    if (!leadId) {
      console.error("  cannot continue without the lead:", created.status, JSON.stringify(createdBody.fields ?? createdBody.error));
      throw new Error("lead creation failed");
    }
    if (leadId) cleanup.leadIds.push(leadId);
    check(created.status === 201 && leadId, "creates a lead with every Phase 3 field", String(created.status));
    const stored = await prisma.lead.findUnique({ where: { id: leadId } });
    check(stored?.tags === "brunch,vip" && stored?.sourceDetail === "Food expo 2026" && stored?.industry === "Fine dining", "fields stored and normalized", stored?.tags);
    check((await prisma.leadStageEvent.count({ where: { leadId } })) === 1, "its opening stage starts the history");

    const dup = await send(founder, "POST", "/api/leads", { ...payload, businessName: `${MARK} Bistro (again)`, email: payload.email.toUpperCase() });
    const dupBody = await json(dup);
    check(dup.status === 409 && dupBody.duplicateOf === leadId, "a duplicate (same email, any case) is refused and points to the original", String(dup.status));

    // ------------------------------------------------------------ lifecycle
    console.log("\nLIFECYCLE");
    for (const stage of ["CONTACTED", "QUALIFIED", "MEETING", "PROPOSAL", "NEGOTIATION"]) {
      const res = await send(founder, "PATCH", `/api/leads/${leadId}/stage`, { stage });
      check(res.status === 200, `moves to ${stage}`, String(res.status));
    }
    check((await prisma.leadStageEvent.count({ where: { leadId } })) === 6, "every move is in the stage history");
    const noReason = await send(founder, "PATCH", `/api/leads/${leadId}/stage`, { stage: "LOST" });
    check(noReason.status === 422, "losing a deal without a reason is refused", String(noReason.status));
    const logged = await send(founder, "POST", `/api/leads/${leadId}/activities`, { type: "MEETING_HELD", note: "Tasting menu walkthrough with the owner." });
    check(logged.ok, "logs a meeting on the timeline", String(logged.status));

    // ------------------------------------------------------------ conversion
    console.log("\nCONVERSION — one action");
    const beforeAccounts = await prisma.clientAccount.count();
    const taken = await prisma.user.findFirst({ select: { email: true } });
    const failed = await send(founder, "POST", `/api/leads/${leadId}/convert`, { serviceIds: service ? [service.id] : [], invite: { name: "Taken", email: taken.email } });
    check(failed.status === 409, "a conversion that can't complete is refused", String(failed.status));
    check((await prisma.clientAccount.count()) === beforeAccounts && !(await prisma.lead.findUnique({ where: { id: leadId } })).convertedClientId, "…and leaves nothing half-made");

    const inviteEmail = `owner.${MARK.toLowerCase()}@bistro.example`;
    const conv = await send(founder, "POST", `/api/leads/${leadId}/convert`, {
      serviceIds: service ? [service.id] : [],
      projectTitle: `${MARK} onboarding`,
      invite: { name: "Test Owner", email: inviteEmail },
    });
    const out = await json(conv);
    if (out.clientId) cleanup.clientIds.push(out.clientId);
    if (out.clientAccountId) cleanup.accountIds.push(out.clientAccountId);
    cleanup.userEmails.push(inviteEmail);
    check(conv.status === 201 && out.clientId && out.projectId && out.clientAccountId, "converts in one call", String(conv.status));

    const client = await prisma.client.findUnique({ where: { id: out.clientId } });
    // The lead's tags as converted: an AI employee may have tagged it since
    // creation (Phase 9's "Qualify every new lead" adds fit:<band>).
    const convertedLead = await prisma.lead.findUnique({ where: { id: leadId }, select: { tags: true } });
    check(
      client &&
        client.businessName === payload.businessName &&
        client.email === payload.email &&
        client.website === payload.website &&
        client.location === payload.location &&
        client.industry === payload.industry &&
        client.tags === convertedLead.tags &&
        convertedLead.tags.split(",").slice(0, 2).join(",") === "brunch,vip" &&
        client.notes === payload.notes &&
        client.clientAccountId === out.clientAccountId,
      "the client carries every lead field — nothing re-typed",
    );
    const project = await prisma.project.findUnique({ where: { id: out.projectId }, include: { services: true } });
    check(project?.clientId === out.clientId && project.title === `${MARK} onboarding` && project.services.length === (service ? 1 : 0), "the first project exists with its services");
    const lead = await prisma.lead.findUnique({ where: { id: leadId } });
    check(lead?.stage === "WON" && lead.convertedClientId === out.clientId && lead.convertedAt, "the lead is marked Won and linked");
    const acts = await prisma.salesActivity.findMany({ where: { leadId } });
    check(acts.length > 0 && acts.every((a) => a.clientId === out.clientId), "the lead's whole history is linked to the client");
    check(acts.filter((a) => a.type === "DEAL_CLOSED").length === 1, "exactly one deal-closed entry");
    check((await prisma.auditLog.count({ where: { action: "LEAD_CONVERTED", entityId: leadId } })) === 1, "the conversion is audit-logged");
    const invited = await prisma.user.findUnique({ where: { email: inviteEmail } });
    check(invited?.role === "CLIENT" && invited.clientAccountId === out.clientAccountId && invited.mustChangePassword, "the client login belongs to its account and must change its password");
    const portal = new Session("client");
    await portal.signIn(inviteEmail, out.invitedUser?.temporaryPassword ?? "x").catch(() => {});
    check((await portal.fetch("/api/leads")).status === 403, "the new client login is refused the team product");
    check((await send(founder, "POST", `/api/leads/${leadId}/convert`, {})).status === 409, "converting twice is refused");

    // ------------------------------------------------------------ export / import
    console.log("\nCSV");
    const csv = await founder.fetch(`/api/leads/export?f=${encodeURIComponent(JSON.stringify({ q: MARK }))}`);
    const text = await csv.text();
    check(csv.headers.get("content-type")?.includes("text/csv") && text.startsWith("business_name,contact_name") && text.includes(`${MARK} Bistro`), "exports the filtered leads as CSV");

    const importCsv = [
      "business_name,contact_name,email,source,deal_value,tags,stage",
      `${MARK} Imported,Ann Lee,ann@${MARK.toLowerCase()}.example,referral,2500,catering,Contacted`,
      `${MARK} Copy,Test Owner,${payload.email},outreach,,,`,
      `X,,not-an-email,carrier pigeon,lots,,`,
    ].join("\n");
    const upload = (mode) => {
      const form = new FormData();
      form.append("file", new Blob([importCsv], { type: "text/csv" }), "leads.csv");
      form.append("departmentId", dept.id);
      form.append("mode", mode);
      return founder.fetch("/api/leads/import", { method: "POST", body: form });
    };
    const preview = await json(await upload("preview"));
    check(preview.summary?.valid === 2 && preview.summary?.invalid === 1 && preview.summary?.duplicates === 1 && preview.summary?.willImport === 1, "preview: 1 new, 1 duplicate, 1 invalid", JSON.stringify(preview.summary));
    check((await prisma.lead.count({ where: { businessName: `${MARK} Imported` } })) === 0, "a preview writes nothing");
    const commit = await json(await upload("commit"));
    const imported = await prisma.lead.findFirst({ where: { businessName: `${MARK} Imported` } });
    if (imported) cleanup.leadIds.push(imported.id);
    check(commit.summary?.imported === 1 && imported?.stage === "CONTACTED" && imported.source === "REFERRAL", "commit imports only the new valid row, on the named stage");
    check(imported && (await prisma.leadStageEvent.count({ where: { leadId: imported.id } })) === 1, "an imported lead starts its stage history too");

    // ------------------------------------------------------------ views
    console.log("\nSAVED VIEWS");
    const view = await json(await send(founder, "POST", "/api/views", { name: `${MARK} referrals`, filters: { sources: ["REFERRAL"], tag: "catering" } }));
    const listed = await json(await founder.fetch("/api/views"));
    check((listed.views ?? []).some((v) => v.id === view.view?.id && v.filters.tag === "catering"), "saves and lists a view with its filters");
    check((await employee.fetch("/api/views")).ok && !((await json(await employee.fetch("/api/views"))).views ?? []).some((v) => v.id === view.view?.id), "a view is private to its owner");
    check((await founder.fetch(`/api/views/${view.view?.id}`, { method: "DELETE" })).ok, "deletes it");

    // ------------------------------------------------------------ boundaries
    console.log("\nBOUNDARIES");
    const upload403 = new FormData();
    upload403.append("file", new Blob([importCsv], { type: "text/csv" }), "leads.csv");
    upload403.append("departmentId", dept.id);
    check((await employee.fetch("/api/leads/import", { method: "POST", body: upload403 })).status === 403, "an employee can't bulk-import");
    check((await employee.fetch("/api/leads/analytics")).status === 403, "an employee can't read leads analytics");
    const empTable = await json(await employee.fetch(`/api/leads/table?f=${encodeURIComponent(JSON.stringify({ minValue: 999999999 }))}`));
    check(empTable.canSeeValues === false && empTable.total > 0, "value filters are ignored for someone who can't see values", String(empTable.total));

    // ------------------------------------------------------------ scale
    console.log(`\nSCALE — ${BULK.toLocaleString()} more leads`);
    const owner = await prisma.user.findUnique({ where: { email: FOUNDER }, select: { id: true } });
    const stagesKeys = ["NEW_LEAD", "CONTACTED", "QUALIFIED", "MEETING", "PROPOSAL", "NEGOTIATION"];
    await prisma.lead.createMany({
      data: Array.from({ length: BULK }, (_, i) => ({
        departmentId: dept.id,
        businessName: `${MARK} Bulk ${i}`,
        contactName: "Bulk",
        stage: stagesKeys[i % stagesKeys.length],
        ownerId: owner.id,
        dealValue: 1000,
      })),
    });
    const expected = await prisma.lead.count({ where: { departmentId: dept.id } });

    const t0 = Date.now();
    const board = await founder.fetch(`/api/pipeline?departmentId=${dept.id}`);
    const boardMs = Date.now() - t0;
    const b = await json(board);
    const counted = (b.totals ?? []).reduce((t, x) => t + x.count, 0);
    check(board.ok && counted === expected, "column counts cover every lead", `${counted} of ${expected}`);
    check((b.leads ?? []).length <= 50 * (b.stages ?? []).length, "…while only the first page of each column is sent", `${(b.leads ?? []).length} cards`);
    check(boardMs < 3000, `the board answers fast (${boardMs} ms)`, `${boardMs} ms`);
    const more = await json(await founder.fetch(`/api/pipeline?departmentId=${dept.id}&stage=NEW_LEAD&skip=50`));
    check((more.leads ?? []).length === 50 && more.hasMore === true, "a column loads its next page on demand");
    const t1 = Date.now();
    const table = await json(await founder.fetch(`/api/leads/table?page=10&pageSize=50&f=${encodeURIComponent(JSON.stringify({ departmentId: dept.id }))}`));
    check(table.leads?.length === 50 && table.total >= BULK && Date.now() - t1 < 3000, `the table pages through them (page 10 in ${Date.now() - t1} ms)`);
  } finally {
    await prisma.lead.deleteMany({ where: { businessName: { startsWith: MARK } } });
    for (const id of cleanup.clientIds) await prisma.project.deleteMany({ where: { clientId: id } });
    await prisma.user.deleteMany({ where: { email: { in: cleanup.userEmails } } });
    await prisma.client.deleteMany({ where: { id: { in: cleanup.clientIds } } });
    await prisma.clientAccount.deleteMany({ where: { id: { in: cleanup.accountIds } } });
    await prisma.savedView.deleteMany({ where: { name: { startsWith: MARK } } });
    await prisma.$disconnect();
  }

  console.log(`\n${checks} checks`);
  if (failures > 0) {
    console.error(`\n✗ ${failures} of ${checks} checks failed`);
    process.exit(1);
  }
  console.log("\n✓ a lead went from first contact to client and project with nothing typed twice, at scale");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
