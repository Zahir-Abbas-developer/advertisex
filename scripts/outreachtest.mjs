#!/usr/bin/env node
/**
 * outreachtest — "Outreach metrics reconcile exactly with logged activities",
 * over real HTTP.
 *
 * An employee logs a known number of each outreach type on a lead; the
 * rollups the API returns must equal what was logged (and what the database
 * holds) — for the employee's own view and for the founder's per-person view,
 * by day, week and month. The employee must see only their own outreach.
 *
 *   SMOKE_BASE=http://localhost:3000 npm run outreachtest
 */

import { loadEnv, Session, waitForServer } from "./smoke.mjs";

loadEnv();

const SEED_PASSWORD = process.env.SEED_PASSWORD ?? "advertisex-change-me";
const FOUNDER = "coachd@bwm.local";
const EMPLOYEE = "tayyaba@bwm.local";
const MARK = `Outreachtest${Date.now().toString(36)}`;

/** type → how many to log, and the kind it must count as. */
const PLAN = [
  ["COLD_CALL", 3, "coldCalls"],
  ["EMAIL_SENT", 4, "emailsSent"],
  ["EMAIL_REPLY", 2, "emailsReplied"],
  ["FOLLOW_UP", 3, "followUps"],
  ["MEETING_BOOKED", 2, "meetingsBooked"],
  ["MEETING_HELD", 1, "meetingsCompleted"],
  ["PROPOSAL_SENT", 1, "proposalsSent"],
  ["NOTE", 2, null],
];

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

async function main() {
  await waitForServer();
  const { PrismaClient } = await import("@prisma/client");
  const prisma = new PrismaClient();
  await prisma.user.updateMany({ where: { email: { in: [FOUNDER, EMPLOYEE] } }, data: { mustChangePassword: false } });

  const employee = await prisma.user.findUnique({
    where: { email: EMPLOYEE },
    select: { id: true, departments: { select: { departmentId: true } } },
  });
  const other = await prisma.user.findUnique({ where: { email: FOUNDER }, select: { id: true } });

  const lead = await prisma.lead.create({
    data: { departmentId: employee.departments[0].departmentId, businessName: `${MARK} Diner`, contactName: "Test", stage: "CONTACTED", ownerId: employee.id },
  });

  try {
    const me = new Session("employee");
    await me.signIn(EMPLOYEE, SEED_PASSWORD);
    const founder = new Session("founder");
    await founder.signIn(FOUNDER, SEED_PASSWORD);

    // Baselines first: the rollups include everything already logged today.
    const baseline = {};
    for (const period of ["day", "week", "month"]) baseline[period] = await json(await me.fetch(`/api/outreach?period=${period}`));
    const founderBaseline = await json(await founder.fetch(`/api/outreach?period=day`));

    console.log("\nLOGGING");
    let logged = 0;
    for (const [type, n] of PLAN) {
      for (let i = 0; i < n; i++) {
        const res = await me.fetch(`/api/leads/${lead.id}/activities`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ type, note: `${MARK} ${type} ${i}` }),
        });
        if (res.ok) logged++;
      }
    }
    const total = PLAN.reduce((t, [, n]) => t + n, 0);
    check(logged === total, `logged ${total} activities`, `${logged}`);

    console.log("\nRECONCILIATION — the employee's own view");
    for (const period of ["day", "week", "month"]) {
      const now = await json(await me.fetch(`/api/outreach?period=${period}`));
      for (const [, n, kind] of PLAN) {
        if (!kind) continue;
        const delta = (now.total?.[kind] ?? 0) - (baseline[period].total?.[kind] ?? 0);
        check(delta === n, `${period}: ${kind} rose by exactly ${n}`, `rose by ${delta}`);
      }
      const bucketSum = (now.buckets ?? []).reduce((t, b) => t + Object.values(b.total).reduce((x, y) => x + y, 0), 0);
      const totalSum = Object.values(now.total ?? {}).reduce((x, y) => x + y, 0);
      check(bucketSum === totalSum && totalSum === now.counted, `${period}: buckets add up to the total and to the rows counted`, `${bucketSum} / ${totalSum} / ${now.counted}`);
    }

    const today = await json(await me.fetch(`/api/outreach?period=day`));
    const dbCount = await prisma.salesActivity.count({
      where: { userId: employee.id, occurredAt: { gte: new Date(today.from), lte: new Date(today.to) }, type: { in: ["COLD_CALL", "CALL", "EMAIL_SENT", "EMAIL", "EMAIL_REPLY", "FOLLOW_UP", "MEETING_BOOKED", "MEETING_HELD", "MEETING", "PROPOSAL_SENT", "QUOTE", "DEAL_CLOSED"] } },
    });
    check(today.counted === dbCount, "the rows counted equal the database's own count", `${today.counted} vs ${dbCount}`);
    check(today.scope === "self" && Object.keys(today.byUser ?? {}).every((id) => id === employee.id), "an employee sees only their own outreach");
    const snoop = await json(await me.fetch(`/api/outreach?period=day&userId=${other.id}`));
    check(Object.keys(snoop.byUser ?? {}).every((id) => id === employee.id), "asking for someone else's outreach still returns only their own");

    console.log("\nRECONCILIATION — the founder's view");
    const fNow = await json(await founder.fetch(`/api/outreach?period=day`));
    for (const [, n, kind] of PLAN) {
      if (!kind) continue;
      const delta = (fNow.byUser?.[employee.id]?.[kind] ?? 0) - (founderBaseline.byUser?.[employee.id]?.[kind] ?? 0);
      check(delta === n, `per-person ${kind} rose by exactly ${n}`, `rose by ${delta}`);
    }
    check(fNow.scope === "company", "the founder sees the company");
  } finally {
    await prisma.salesActivity.deleteMany({ where: { leadId: lead.id } });
    await prisma.lead.delete({ where: { id: lead.id } }).catch(() => {});
    await prisma.$disconnect();
  }

  console.log(`\n${checks} checks`);
  if (failures > 0) {
    console.error(`\n✗ ${failures} of ${checks} checks failed`);
    process.exit(1);
  }
  console.log("\n✓ every outreach figure reconciles exactly with what was logged");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
