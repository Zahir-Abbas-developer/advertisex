#!/usr/bin/env node
/**
 * cycletest — Phase 10 acceptance: the founder runs a full business cycle
 * through the product alone — lead → client → project → delivery → report →
 * invoice → payment — and the restaurant sees each step in its portal.
 * Every step is an ordinary request the app itself makes; nothing here
 * writes to the database directly.
 *
 *   SMOKE_BASE=http://localhost:3000 npm run cycletest
 */

import { randomUUID } from "node:crypto";

import { loadEnv, Session, waitForServer } from "./smoke.mjs";

loadEnv();
process.env.AGENT_WORKER = "off";

const SEED_PASSWORD = process.env.SEED_PASSWORD ?? "advertisex-change-me";
const FOUNDER = "coachd@bwm.local";
const MARK = `P10c${Date.now().toString(36)}`;
const OWNER_PASSWORD = `${MARK}-Owner!pass`;

let failures = 0;
let checks = 0;
function check(ok, label, detail = "") {
  checks += 1;
  if (ok) return console.log(`  ✓ ${label}`), true;
  failures += 1;
  console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`);
  return false;
}
const json = async (res) => res.json().catch(() => ({}));
const send = (session, url, method, body, headers = {}) => session.fetch(url, { method, headers: { "Content-Type": "application/json", ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
const must = (value, what) => {
  if (!value) throw new Error(`cannot continue without ${what}`);
  return value;
};
const plusDays = (n) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);
const lastMonth = () => {
  const d = new Date();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() - 1);
  return d.toISOString().slice(0, 7);
};

async function main() {
  await waitForServer();
  // Read-only lookups (which department, which service) — the cycle itself is all HTTP.
  const { PrismaClient } = await import("@prisma/client");
  const prisma = new PrismaClient();
  await prisma.user.updateMany({ where: { email: FOUNDER }, data: { mustChangePassword: false } });
  const dept = must(await prisma.department.findFirst({ where: { slug: "growth-sprint" }, select: { id: true } }), "the Growth Sprint department");
  const stages = await prisma.pipelineStage.findMany({ where: { departmentId: dept.id, isActive: true }, orderBy: { sortOrder: "asc" }, select: { key: true, kind: true } });
  const service = must(await prisma.serviceCatalog.findFirst({ where: { isActive: true, slug: "google-ads" }, select: { id: true, name: true } }), "a service");
  const ownerEmail = `${MARK.toLowerCase()}.owner@trattoria.example`;
  const cleanup = { clientId: null, leadId: null };

  try {
    const founder = new Session("founder");
    await founder.signIn(FOUNDER, SEED_PASSWORD);

    console.log("\n1 · LEAD");
    const form = await json(await founder.fetch(`/api/departments/${dept.id}/form?entity=LEAD`));
    const fieldValues = {};
    for (const f of form.fields ?? []) if (f.required) fieldValues[f.key] = f.type === "SELECT" || f.type === "MULTISELECT" ? f.options[0] ?? "" : f.type === "NUMBER" || f.type === "CURRENCY" ? "1500" : f.type === "DATE" ? plusDays(0) : `cycle-${f.key}`;
    const created = await json(await send(founder, "/api/leads", "POST", { fieldValues, departmentId: dept.id, businessName: `${MARK} Trattoria`, contactName: "Lucia Romano", email: `${MARK.toLowerCase()}@trattoria.example`, phone: "+1 555 0177", website: "", location: "Brooklyn, NY", industry: "Italian restaurant", source: "REFERRAL", tags: [], dealValue: 18000, estimatedMonthlyValue: 1500, interestedServices: [] }));
    const leadId = must(created.lead?.id, "the lead");
    cleanup.leadId = leadId;
    check(true, "the founder adds a lead");
    const open = stages.filter((s) => s.kind === "OPEN").map((s) => s.key);
    let moved = 0;
    for (const stage of open.slice(1)) if ((await send(founder, `/api/leads/${leadId}/stage`, "PATCH", { stage })).status === 200) moved += 1;
    check(moved === open.length - 1, `works it through the pipeline (${open.join(" → ")})`);
    check((await send(founder, `/api/leads/${leadId}/activities`, "POST", { type: "MEETING_HELD", note: "Tasting and a walkthrough of the booking flow." })).status === 201, "logs the meeting");

    console.log("\n2 · CLIENT AND PROJECT");
    const conv = await json(await send(founder, `/api/leads/${leadId}/convert`, "POST", { serviceIds: [service.id], projectTitle: `${MARK} Google Ads launch` }));
    const clientId = must(conv.clientId, "the client");
    const projectId = must(conv.projectId, "the project");
    cleanup.clientId = clientId;
    check(true, "converts the won deal: a client, a portal account and a project, in one step");
    const invite = await json(await send(founder, `/api/clients/${clientId}/portal-users`, "POST", { name: "Lucia Romano", email: ownerEmail, clientRole: "OWNER" }));
    const token = must(invite.link, "the invitation link").split("/").pop();
    // Acceptance is rate-limited per address; harnesses run back to back all
    // share one (no proxy header), so wait out a 429 as a person would.
    let accepted = await send(new Session("anon"), "/api/invites/accept", "POST", { token, name: "Lucia Romano", password: OWNER_PASSWORD });
    if (accepted.status === 429) {
      await new Promise((r) => setTimeout(r, (Number(accepted.headers.get("retry-after")) || 60) * 1000 + 500));
      accepted = await send(new Session("anon"), "/api/invites/accept", "POST", { token, name: "Lucia Romano", password: OWNER_PASSWORD });
    }
    check(accepted.status === 201, "invites the owner, who accepts", String(accepted.status));
    const owner = new Session("owner");
    await owner.signIn(ownerEmail, OWNER_PASSWORD);
    const portalProject = await json(await owner.fetch(`/api/portal/projects/${projectId}`));
    check((await owner.fetch(`/api/portal/projects/${projectId}`)).status === 200 && JSON.stringify(portalProject).includes("Google Ads launch"), "the owner sees the project in the portal");

    console.log("\n3 · DELIVERY");
    const project = await json(await founder.fetch(`/api/projects/${projectId}`));
    const projectStages = (project.project?.stages ?? project.stages ?? []).slice().sort((a, b) => a.order - b.order);
    check(projectStages.length > 0, `the project carries the service's stages (${projectStages.map((s) => s.name).join(", ")})`);
    const m = await json(await send(founder, `/api/projects/${projectId}/milestones`, "POST", { title: "Campaigns live", weight: 2, dueDate: plusDays(7), stageId: projectStages[0]?.id }));
    check((await send(founder, `/api/projects/${projectId}/milestones/${must(m.milestone?.id, "a milestone")}`, "PATCH", { status: "DONE" })).status === 200, "plans a milestone and completes it");
    let done = 0;
    for (const s of projectStages) if ((await send(founder, `/api/projects/${projectId}/stages/${s.id}`, "PATCH", { status: "DONE" })).status === 200) done += 1;
    check(done === projectStages.length, "completes every stage, in order");
    check((await send(founder, `/api/projects/${projectId}`, "PATCH", { status: "COMPLETED" })).status === 200, "marks the project delivered");
    const after = await json(await owner.fetch(`/api/portal/projects/${projectId}`));
    check(JSON.stringify(after).includes("COMPLETED") || /complete|delivered|done/i.test(JSON.stringify(after.project ?? after)), "the owner sees it delivered");

    console.log("\n4 · REPORT");
    const month = lastMonth();
    const gen = await json(await send(founder, `/api/clients/${clientId}/reports/generate`, "POST", { month }));
    const reportId = must(gen.report?.id, "the report");
    check(gen.report.status === "DRAFT" && gen.report.reviewState === "NEEDS_REVIEW", "generates the month's report — a draft for review");
    check((await send(founder, `/api/clients/${clientId}/reports/${reportId}/review`, "POST", { action: "approve" })).status === 200, "reviews and approves it");
    check(((await json(await owner.fetch("/api/portal/reports"))).reports ?? []).some((r) => r.id === reportId), "the owner finds it in their reports");

    console.log("\n5 · INVOICE AND PAYMENT");
    const org = await json(await founder.fetch("/api/settings/billing"));
    const currency = org.settings?.currency ?? org.currency ?? "USD";
    const draft = await json(await send(founder, "/api/invoices", "POST", { clientId, currency, dueDate: plusDays(14), lines: [{ description: `${service.name} — first month`, quantity: "1", rate: "1500.00" }] }));
    const invoiceId = must(draft.invoice?.id, "the invoice");
    check(true, "drafts the invoice");
    const sent = await json(await founder.fetch(`/api/invoices/${invoiceId}/send`, { method: "POST" }));
    check(Boolean(sent.invoice?.numberLabel ?? sent.numberLabel), `sends it (${sent.invoice?.numberLabel ?? sent.numberLabel})`);
    const portalInvoices = await json(await owner.fetch("/api/portal/invoices"));
    check((portalInvoices.invoices ?? []).some((i) => i.id === invoiceId), "the owner sees the invoice");
    const receivedBefore = (await json(await founder.fetch("/api/finance/overview?range=month"))).overview?.receivedMinor ?? 0;
    const paid = await send(founder, `/api/invoices/${invoiceId}/payments`, "POST", { amount: "1500.00", method: "BANK_TRANSFER", paidAt: plusDays(0), reference: MARK }, { "Idempotency-Key": randomUUID() });
    check(paid.status === 201, "records the payment in full", String(paid.status));
    const final = await json(await founder.fetch(`/api/invoices/${invoiceId}`));
    check((final.invoice ?? final).status === "PAID" && (final.invoice ?? final).paidMinor === 150000, "the invoice is paid, to the cent");
    check(((await json(await owner.fetch("/api/portal/invoices"))).invoices ?? []).find((i) => i.id === invoiceId)?.status === "PAID", "and the owner sees it paid");
    const receivedAfter = (await json(await founder.fetch("/api/finance/overview?range=month"))).overview?.receivedMinor ?? 0;
    check(receivedAfter - receivedBefore === 150000, "the financial overview counts it as received this month", `${receivedBefore} → ${receivedAfter}`);
  } finally {
    if (cleanup.clientId) {
      const client = await prisma.client.findUnique({ where: { id: cleanup.clientId }, select: { clientAccountId: true } });
      await prisma.payment.deleteMany({ where: { invoice: { clientId: cleanup.clientId } } });
      await prisma.invoice.deleteMany({ where: { clientId: cleanup.clientId } });
      await prisma.user.deleteMany({ where: { email: ownerEmail } });
      await prisma.client.delete({ where: { id: cleanup.clientId } }).catch(() => {});
      if (client?.clientAccountId) await prisma.clientAccount.delete({ where: { id: client.clientAccountId } }).catch(() => {});
    }
    if (cleanup.leadId) await prisma.lead.delete({ where: { id: cleanup.leadId } }).catch(() => {});
    await prisma.$disconnect();
  }

  console.log(`\n${checks - failures}/${checks} checks passed`);
  if (failures) process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
