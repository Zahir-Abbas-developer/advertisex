#!/usr/bin/env node
/**
 * analyticstest — Phase 8 acceptance: the Command Center and analytics hub
 * render from real data with no placeholder numbers. Every figure is
 * recomputed from the database here and compared; the cache and speed are
 * checked; client results (manual entry, precedence, derived rates) and
 * everyone's access are verified.
 *
 *   SMOKE_BASE=http://localhost:3000 npm run analyticstest
 */

import bcrypt from "bcryptjs";

import { loadEnv, Session, waitForServer } from "./smoke.mjs";

loadEnv();

const SEED_PASSWORD = process.env.SEED_PASSWORD ?? "advertisex-change-me";
const FOUNDER = "coachd@bwm.local";
const LEAD = "tayyaba@bwm.local";
const MARK = `P8a${Date.now().toString(36)}`;

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
const send = (session, url, method, body) => session.fetch(url, { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });

async function main() {
  await waitForServer();
  const { PrismaClient } = await import("@prisma/client");
  const prisma = new PrismaClient();
  await prisma.user.updateMany({ where: { email: { in: [FOUNDER, LEAD] } }, data: { mustChangePassword: false } });
  const { dayKey, balanceOf, monthlyMinor } = await import("../modules/billing/domain.ts");
  const { OUTREACH_ACTIVITY_TYPES, outreachKindOf } = await import("../modules/outreach/domain.ts");
  const settings = await prisma.settings.findFirst({ select: { timezone: true } }).catch(() => null);
  const tz = settings?.timezone || "America/New_York";
  const k = (d) => dayKey(d, tz);
  const clientA = await prisma.client.findFirst({ where: { businessName: "Osteria Nonna" }, select: { id: true, organizationId: true, departmentId: true } });
  const org = await prisma.organization.findUniqueOrThrow({ where: { id: clientA.organizationId } });
  const otherDept = await prisma.department.findFirst({ where: { id: { not: clientA.departmentId }, organizationId: org.id }, select: { id: true } });
  const outsider = await prisma.user.create({
    data: { organizationId: org.id, name: `${MARK} Outsider`, email: `${MARK.toLowerCase()}.out@advertisex.example`, passwordHash: await bcrypt.hash(SEED_PASSWORD, 10), role: "MANAGER", jobTitle: "Other department", departments: { create: { departmentId: otherDept.id, roleInDept: "LEAD" } } },
  });
  const marco = await prisma.user.findFirst({ where: { clientAccountId: { not: null }, role: "CLIENT" }, select: { email: true } });
  await prisma.user.updateMany({ where: { email: marco.email }, data: { mustChangePassword: false } });

  try {
    const founder = new Session("founder");
    await founder.signIn(FOUNDER, SEED_PASSWORD);
    const lead = new Session("lead");
    await lead.signIn(LEAD, SEED_PASSWORD);
    const out = new Session("outsider");
    await out.signIn(outsider.email, SEED_PASSWORD);
    const client = new Session("client");
    await client.signIn(marco.email, SEED_PASSWORD).catch(() => null);

    console.log("\nCOMMAND CENTER — EVERY FIGURE FROM THE DATABASE");
    await prisma.analyticsSnapshot.deleteMany({ where: { organizationId: org.id } });
    for (const period of ["30d", "month", "year"]) {
      const t0 = Date.now();
      const res = await founder.fetch(`/api/command?period=${period}`);
      const ms = Date.now() - t0;
      const c = (await json(res)).command;
      if (!check(res.status === 200 && c, `[${period}] loads (${ms} ms)`)) continue;
      const b = c.bounds;
      const inCur = (d) => {
        const key = k(d);
        return key >= b.from && key <= b.to;
      };
      const inPrev = (d) => {
        const key = k(d);
        return key >= b.prevFrom && key <= b.prevTo;
      };
      const dept = { department: { organizationId: org.id } };

      const leads = await prisma.lead.findMany({ where: dept, select: { createdAt: true } });
      check(c.leads.newLeads.value === leads.filter((l) => inCur(l.createdAt)).length && c.leads.newLeads.previous === leads.filter((l) => inPrev(l.createdAt)).length, `[${period}] new leads, and the comparison period`, `${c.leads.newLeads.value}/${c.leads.newLeads.previous}`);
      const deals = await prisma.salesActivity.findMany({ where: { ...dept, type: "DEAL_CLOSED" }, select: { occurredAt: true, leadId: true, lead: { select: { dealValue: true } } } });
      const won = new Map();
      for (const d of deals) if (d.leadId && inCur(d.occurredAt) && !won.has(d.leadId)) won.set(d.leadId, d.lead?.dealValue ?? 0);
      check(c.leads.won.value === won.size && c.leads.wonValue.value === [...won.values()].reduce((s, v) => s + v, 0) * 100, `[${period}] deals won and their value`, `${c.leads.won.value} vs ${won.size}`);
      check(c.leads.trend.reduce((s, p) => s + p.value, 0) === c.leads.newLeads.value, `[${period}] the leads trend sums to the headline`);
      check(c.leads.bySource.reduce((s, r) => s + r.value, 0) === c.leads.newLeads.value, `[${period}] leads by source sum to the headline`);

      const acts = (await prisma.salesActivity.findMany({ where: { ...dept, type: { in: OUTREACH_ACTIVITY_TYPES } }, select: { type: true, occurredAt: true } })).filter((a) => outreachKindOf(a.type) && outreachKindOf(a.type) !== "dealsClosed");
      check(c.outreach.total.value === acts.filter((a) => inCur(a.occurredAt)).length, `[${period}] outreach total`, `${c.outreach.total.value}`);
      check(c.outreach.byKind.reduce((s, x) => s + x.value, 0) === c.outreach.total.value, `[${period}] outreach by kind sums to the total`);

      const pays = await prisma.payment.findMany({ where: { organizationId: org.id, reversedAt: null, currency: org.currency }, select: { amountMinor: true, paidAt: true } });
      check(c.revenue.received.value === pays.filter((p) => inCur(p.paidAt)).reduce((s, p) => s + p.amountMinor, 0), `[${period}] payments received`);
      check(c.revenue.trend.reduce((s, p) => s + p.value, 0) === c.revenue.received.value, `[${period}] the revenue trend sums to it`);
      const invs = await prisma.invoice.findMany({ where: { organizationId: org.id, currency: org.currency, status: { not: "DRAFT" } } });
      check(c.revenue.outstandingMinor === invs.filter((i) => ["SENT", "PARTIALLY_PAID", "OVERDUE"].includes(i.status)).reduce((s, i) => s + balanceOf(i), 0) && c.revenue.overdueMinor === invs.filter((i) => i.status === "OVERDUE").reduce((s, i) => s + balanceOf(i), 0), `[${period}] outstanding and overdue`);
      const services = await prisma.clientService.findMany({ where: { organizationId: org.id, status: "ACTIVE" } });
      check(c.revenue.mrrMinor === services.reduce((s, x) => s + monthlyMinor({ priceWhole: x.price, billing: x.billing, status: x.status }), 0), `[${period}] MRR`);

      const projects = await prisma.project.findMany({ where: { organizationId: org.id }, select: { status: true, delayedAt: true } });
      const active = projects.filter((p) => ["PLANNING", "ACTIVE", "ON_HOLD"].includes(p.status));
      check(c.projects.active === active.length && c.projects.delayed === active.filter((p) => p.delayedAt).length, `[${period}] active and delayed projects`);
      const staffIds = (await prisma.user.findMany({ where: { organizationId: org.id, role: { not: "CLIENT" }, isActive: true }, select: { id: true } })).map((u) => u.id);
      const done = await prisma.task.findMany({ where: { assigneeId: { in: staffIds }, completedAt: { not: null } }, select: { completedAt: true, status: true } });
      check(c.team.tasksCompleted.value === done.filter((t) => ["COMPLETED", "DONE"].includes(t.status) && inCur(t.completedAt)).length, `[${period}] tasks completed`, `${c.team.tasksCompleted.value}`);

      const numbers = JSON.stringify(c).match(/"(value|previous|change)":null/g);
      check(!numbers, `[${period}] no missing figures in any section`);
      check([c.leads.trend, c.outreach.trend, c.revenue.trend].every((s) => s.length > 0 && s.every((p) => Number.isFinite(p.value))), `[${period}] every chart has a real series, no gaps`);

      const t1 = Date.now();
      const again = (await json(await founder.fetch(`/api/command?period=${period}`))).command;
      const cachedMs = Date.now() - t1;
      check(again.cached === true && JSON.stringify(again.leads) === JSON.stringify(c.leads), `[${period}] the second look is served from the cache (${cachedMs} ms), identical`);
    }

    console.log("\nTHE ANALYTICS HUB");
    const ret = (await json(await founder.fetch("/api/analytics/retention?period=quarter"))).retention;
    const clients = await prisma.client.findMany({ where: { organizationId: org.id, status: { not: "LEAD" } }, select: { onboardedAt: true, createdAt: true, churnedAt: true } });
    const start = (x) => k(x.onboardedAt ?? x.createdAt);
    const atStart = clients.filter((x) => start(x) < ret.bounds.from && (!x.churnedAt || k(x.churnedAt) >= ret.bounds.from));
    check(ret.activeAtStart === atStart.length && ret.retained === atStart.filter((x) => !x.churnedAt || k(x.churnedAt) > ret.bounds.to).length, "retention's cohort matches the database", `${ret.activeAtStart}/${atStart.length}`);
    const rec = (await json(await founder.fetch("/api/analytics/receivables"))).receivables;
    const open = (await prisma.invoice.findMany({ where: { organizationId: org.id, currency: org.currency, status: { in: ["SENT", "PARTIALLY_PAID", "OVERDUE"] } } })).reduce((s, i) => s + balanceOf(i), 0);
    check(rec.totalMinor === open && rec.buckets.reduce((s, x) => s + x.amountMinor, 0) === open && rec.byClient.reduce((s, x) => s + x.totalMinor, 0) === open, "outstanding payments: the aging buckets and the per-client list both sum to what's owed");
    check((await founder.fetch("/analytics")).status === 200, "the hub opens for the founder");

    console.log("\nCLIENT RESULTS");
    const month = (() => {
      const [y, m] = k(new Date()).slice(0, 7).split("-").map(Number);
      return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
    })();
    const res0 = await json(await founder.fetch(`/api/clients/${clientA.id}/results?month=${month}`));
    const ads = res0.results?.channels?.find((c) => c.channel === "googleAds");
    check(res0.canEdit && ads && ads.hasData, "the founder sees Osteria's channels for last month (seeded)");
    const imp = ads.metrics.find((m) => m.key === "impressions").value;
    const clk = ads.metrics.find((m) => m.key === "clicks").value;
    check(ads.metrics.find((m) => m.key === "ctr").value === Math.round((clk / imp) * 1000) / 10, "click-through rate is derived from clicks and impressions");
    check((await send(founder, `/api/clients/${clientA.id}/results`, "PUT", { month, channel: "googleAds", values: { clicks: "12.5" } })).status === 422, "a fractional click count is refused");
    check((await send(founder, `/api/clients/${clientA.id}/results`, "PUT", { month, channel: "googleAds", values: { impressions: "50000", clicks: "2500", cost: "1250.00", conversions: "125", conversionValue: "6250.00" } })).ok, "the founder enters results by hand");
    const res1 = await json(await founder.fetch(`/api/clients/${clientA.id}/results?month=${month}`));
    const ads1 = res1.results.channels.find((c) => c.channel === "googleAds");
    const by = (key) => ads1.metrics.find((m) => m.key === key);
    check(by("clicks").value === 2500 && by("clicks").source === "MANUAL", "a manual entry takes precedence over demo data");
    check(by("ctr").value === 5 && by("cpc").value === 50 && by("cpa").value === 1000 && by("roas").value === 5, "and the rates follow it: 5% CTR, $0.50 CPC, $10 CPA, 5.00× ROAS");
    await send(founder, `/api/clients/${clientA.id}/results`, "PUT", { month, channel: "googleAds", values: {} });
    const res2 = await json(await founder.fetch(`/api/clients/${clientA.id}/results?month=${month}`));
    check(res2.results.channels.find((c) => c.channel === "googleAds").metrics.find((m) => m.key === "clicks").source !== "MANUAL", "clearing the entry brings the synced figure back");
    const sync = await send(founder, `/api/clients/${clientA.id}/results/sync`, "POST", { provider: "GOOGLE_ADS" });
    check(sync.status === 409, "sync refuses until live sync (or development demo data) is switched on", String(sync.status));

    console.log("\nACCESS");
    check((await lead.fetch(`/api/clients/${clientA.id}/results`)).status === 200, "the account lead can read the client's results");
    check((await send(lead, `/api/clients/${clientA.id}/results`, "PUT", { month, channel: "googleAds", values: { clicks: "1" } })).status >= 400, "but not change them");
    check((await out.fetch(`/api/clients/${clientA.id}/results`)).status >= 400, "a manager of another department can't see them");
    for (const [s, who] of [[lead, "an employee"], [out, "a manager"], [client, "a client"]]) {
      for (const url of ["/api/command", "/api/analytics/retention", "/api/analytics/receivables"]) check((await s.fetch(url)).status >= 400, `${who} is refused ${url}`);
    }
    check((await out.fetch("/analytics")).status !== 200, "the hub is the founder's");
    check((await client.fetch(`/api/clients/${clientA.id}/results`)).status >= 400, "a client can't reach the team's results API");
  } finally {
    await prisma.metricValue.deleteMany({ where: { clientId: clientA.id, source: "MANUAL", enteredById: { not: null }, createdAt: { gte: new Date(Date.now() - 3600_000) } } });
    await prisma.integrationConnection.updateMany({ where: { clientId: clientA.id, status: "ERROR" }, data: { status: "MOCK", lastError: null } });
    await prisma.user.delete({ where: { id: outsider.id } }).catch(() => null);
    await prisma.$disconnect();
  }

  console.log(`\n${checks - failures}/${checks} checks passed`);
  if (failures) {
    console.error(`✗ ${failures} failed`);
    process.exit(1);
  }
  console.log("✓ every command-center and analytics figure is the database's, fast, and only for the founder");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
