#!/usr/bin/env node
/**
 * securitytest — Phase 10: every finding of the security audit, proven fixed
 * over HTTP, so none can quietly come back.
 *
 *   headers & CSP · row-scoped client KPIs · lead activity department scope ·
 *   analytics money and colleagues · audit log founder-only · open redirect ·
 *   push SSRF · health detail · cron CSRF · upload disguise · rate limits ·
 *   password change ends other sessions · a demoted founder loses power at once
 *
 *   SMOKE_BASE=http://localhost:3000 npm run securitytest
 */

import bcrypt from "bcryptjs";

import { loadEnv, Session, waitForServer } from "./smoke.mjs";

loadEnv();

const BASE = process.env.SMOKE_BASE ?? "http://localhost:3000";
const SEED_PASSWORD = process.env.SEED_PASSWORD ?? "advertisex-change-me";
const FOUNDER = "coachd@bwm.local";
const MANAGER = "rajazain@bwm.local";
const EMPLOYEE = "cam@bwm.local";
const CLIENT = "jenny@baosociety.example";
const MARK = `P10s${Date.now().toString(36)}`;

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
  await prisma.user.updateMany({ where: { email: { in: [FOUNDER, MANAGER, EMPLOYEE, CLIENT] } }, data: { mustChangePassword: false } });
  const org = (await prisma.user.findUniqueOrThrow({ where: { email: FOUNDER } })).organizationId;
  const [cam, raja] = await Promise.all([EMPLOYEE, MANAGER].map((email) => prisma.user.findUniqueOrThrow({ where: { email } })));
  const grind = await prisma.client.findFirstOrThrow({ where: { businessName: "Grind Coffee Co." } });
  // A client Cam has no link to: another department, no project, not the assignee.
  const bao = await prisma.client.findFirstOrThrow({ where: { businessName: "Bao Society" } });
  const osteria = await prisma.client.findFirstOrThrow({ where: { businessName: "Osteria Nonna" } });
  const retention = await prisma.department.findFirstOrThrow({ where: { slug: "web-retention", organizationId: org } });
  const cleanup = { userIds: [], leadIds: [] };
  const tempUser = async (role, name) => {
    const password = `${MARK}-${name}-Pass!1`;
    const u = await prisma.user.create({ data: { organizationId: org, name: `${MARK} ${name}`, email: `${MARK.toLowerCase()}.${name.toLowerCase()}@bwm.local`, passwordHash: await bcrypt.hash(password, 10), role, jobTitle: name, avatarColor: "#279D61" } });
    cleanup.userIds.push(u.id);
    return { ...u, password };
  };

  try {
    const founder = new Session("founder");
    await founder.signIn(FOUNDER, SEED_PASSWORD);
    const manager = new Session("manager");
    await manager.signIn(MANAGER, SEED_PASSWORD);
    const emp = new Session("employee");
    await emp.signIn(EMPLOYEE, SEED_PASSWORD);
    const client = new Session("client");
    await client.signIn(CLIENT, SEED_PASSWORD);

    console.log("\nHEADERS");
    const page = await fetch(`${BASE}/login`);
    const csp = page.headers.get("content-security-policy") ?? "";
    const html = await page.text();
    const nonce = /'nonce-([^']+)'/.exec(csp)?.[1];
    check(Boolean(nonce) && /script-src 'self' 'nonce-[^']+' 'strict-dynamic'/.test(csp) && !/script-src[^;]*'unsafe-inline'/.test(csp), "pages carry a nonce CSP without inline scripts");
    check(/frame-ancestors 'none'/.test(csp) && page.headers.get("x-frame-options") === "DENY", "pages can't be framed");
    const scripts = [...html.matchAll(/<script\b[^>]*>/g)].map((m) => m[0]);
    check(scripts.length > 0 && scripts.every((s) => s.includes(`nonce="${nonce}"`)), `every script on the page carries this response's nonce (${scripts.length})`);
    for (const [label, res] of [["a page", page], ["an API response", await fetch(`${BASE}/api/health`)]]) {
      check(res.headers.get("x-content-type-options") === "nosniff" && res.headers.get("referrer-policy") === "strict-origin-when-cross-origin" && /camera=\(\)/.test(res.headers.get("permissions-policy") ?? ""), `${label}: nosniff, referrer and permissions policies`);
    }
    const second = (await fetch(`${BASE}/login`)).headers.get("content-security-policy");
    check(second !== csp, "the nonce is fresh on every response");

    console.log("\nROW SCOPE");
    check((await client.fetch(`/api/clients/${osteria.id}/kpis`)).status === 404, "a portal client can't read another restaurant's weekly numbers");
    check((await emp.fetch(`/api/clients/${bao.id}/kpis`)).status === 404, "an employee can't read a client outside their reach");
    check((await send(emp, `/api/clients/${bao.id}/kpis`, "POST", { weekStart: "2026-09-07", revenue: 1 })).status === 404, "nor overwrite its numbers");
    check((await emp.fetch(`/api/clients/${grind.id}/kpis`)).status === 200, "but can read a client they work on (Cam is on Grind's brand refresh)");
    check((await founder.fetch(`/api/clients/${bao.id}/kpis`)).status === 200, "the founder can read any");
    const lead = await prisma.lead.create({ data: { departmentId: retention.id, businessName: `${MARK} Elsewhere`, contactName: "X", source: "OTHER", stage: (await prisma.pipelineStage.findFirstOrThrow({ where: { departmentId: retention.id }, orderBy: { sortOrder: "asc" } })).key, createdById: cam.id } });
    cleanup.leadIds.push(lead.id);
    check((await send(emp, `/api/leads/${lead.id}/activities`, "POST", { type: "COLD_CALL", note: "Called them about it" })).status === 404, "an employee can't log activity on another department's lead");
    const sys = await prisma.salesActivity.create({ data: { departmentId: retention.id, leadId: lead.id, userId: raja.id, type: "STATUS_CHANGE", isSystem: true, note: "A → B" } });
    check((await send(manager, `/api/leads/${lead.id}/activities`, "DELETE", { activityId: sys.id })).status === 403, "system entries on the timeline can't be deleted");
    const baoThreads = await prisma.messageThread.count({ where: { clientId: bao.id } });
    await emp.fetch(`/api/messages/threads?clientId=${bao.id}`);
    check((await prisma.messageThread.count({ where: { clientId: bao.id } })) === baoThreads, "asking about an out-of-reach client's messages creates nothing");

    console.log("\nMONEY AND COLLEAGUES");
    const a = await json(await emp.fetch("/api/analytics"));
    check(a.totals && a.totals.revenue === null && a.totals.openDeals.value === null && a.totals.wonDeals.value === null && (a.byDepartment ?? []).every((r) => r.revenue === null) && (a.charts?.pipelineByStage ?? []).every((r) => r.value === null), "an employee's analytics carry counts, not money");
    check((a.byMember ?? []).every((r) => r.userId === cam.id), "and only their own row of the per-person table");
    check((await emp.fetch(`/api/analytics?memberId=${raja.id}`)).status === 404, "a colleague's figures can't be asked for");
    const f = await json(await founder.fetch("/api/analytics"));
    check(typeof f.totals?.revenue === "number", "the founder still sees revenue");
    const updated = await json(await send(emp, `/api/leads/${(await prisma.lead.findFirstOrThrow({ where: { department: { slug: "growth-sprint" }, dealValue: { gt: 0 }, ownerId: { not: cam.id } } })).id}`, "PATCH", {}));
    check(!updated.lead || !("dealValue" in updated.lead), "a no-op edit doesn't return a withheld deal value");
    check((await manager.fetch("/api/audit")).status === 403 && (await manager.fetch("/api/audit?action=RECORDS")).status === 403, "the audit trail is the founder's (managers refused)");
    check((await founder.fetch("/api/audit?action=RECORDS")).status === 200, "the founder reads it");

    console.log("\nREDIRECTS, SSRF, HEALTH, CRON");
    for (const evil of ["/%5Cevil.example", "/%09/evil.example", "//evil.example", "https://evil.example"]) {
      const body = await (await fetch(`${BASE}/login?callbackUrl=${evil}`)).text();
      // The form's destination prop (Next also echoes the URL itself in its router state — harmless).
      const destinations = [...body.matchAll(/callbackUrl\\":\\"([^"\\]*)/g)].map((m) => m[1]);
      check(destinations.length > 0 && destinations.every((d) => d === "/dashboard"), `sign-in never sends anyone to ${decodeURIComponent(evil)}`, destinations.join(" "));
    }
    const pushed = await send(emp, "/api/push", "POST", { endpoint: "http://169.254.169.254/latest/meta-data", keys: { p256dh: "x", auth: "y" } });
    check(pushed.status === 422, "a push endpoint must be a real push service (no SSRF)", String(pushed.status));
    const health = await json(await fetch(`${BASE}/api/health`));
    check(health.database?.ok === true && !("error" in health.database) && (health.jobs ?? []).every((j) => !("summary" in j)), "anonymous health: verdicts only, no error text or job summaries");
    check((await founder.fetch("/api/cron/agents")).status === 401, "a cron job can't be run by a GET on a founder's session (CSRF)");
    check((await send(founder, "/api/cron/agents", "POST")).status === 200, "the founder can still run one deliberately (POST)");

    console.log("\nUPLOADS");
    const form = new FormData();
    form.set("clientId", osteria.id);
    form.set("file", new File(["<script>alert(1)</script>"], "photo.png", { type: "image/png" }));
    check((await founder.fetch("/api/files", { method: "POST", body: form })).status === 415, "a script disguised as a PNG is refused");
    const real = new FormData();
    real.set("clientId", osteria.id);
    real.set("file", new File([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0])], `${MARK}.png`, { type: "image/png" }));
    const ok = await founder.fetch("/api/files", { method: "POST", body: real });
    check(ok.status === 201, "a real PNG is accepted", String(ok.status));
    const stored = await prisma.file.findFirst({ where: { filename: `${MARK}.png` } });
    if (stored) await prisma.file.delete({ where: { id: stored.id } });

    console.log("\nSESSIONS");
    const guesser = await tempUser("EMPLOYEE", "Guesser");
    const g = new Session("guesser");
    await g.signIn(guesser.email, guesser.password);
    const statuses = [];
    for (let i = 0; i < 6; i++) statuses.push((await send(g, "/api/me/password", "POST", { currentPassword: `wrong-${i}`, newPassword: "a-new-password-1", confirmPassword: "a-new-password-1" })).status);
    check(statuses.slice(0, 5).every((s) => s === 422) && statuses[5] === 429, "guessing the current password is rate-limited", statuses.join(","));

    const traveller = await tempUser("EMPLOYEE", "Traveller");
    const laptop = new Session("laptop");
    await laptop.signIn(traveller.email, traveller.password);
    const phone = new Session("phone");
    await phone.signIn(traveller.email, traveller.password);
    check((await phone.fetch("/api/notifications")).status === 200, "two devices signed in");
    const changed = await send(laptop, "/api/me/password", "POST", { currentPassword: traveller.password, newPassword: `${MARK}-Brand-New!2`, confirmPassword: `${MARK}-Brand-New!2` });
    check(changed.status === 200 && (await json(changed)).email === traveller.email, "the password is changed");
    check((await phone.fetch("/api/notifications")).status === 401, "the other device is signed out at once");
    const again = new Session("laptop-again");
    await again.signIn(traveller.email, `${MARK}-Brand-New!2`);
    check((await again.fetch("/api/notifications")).status === 200, "signing in with the new password works");

    const exFounder = await tempUser("FOUNDER", "Exfounder");
    const x = new Session("ex-founder");
    await x.signIn(exFounder.email, exFounder.password);
    const first = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1));
    const existing = await prisma.attendanceDay.findFirst({ where: { userId: cam.id, date: { gte: first } } });
    const day = existing ?? (await prisma.attendanceDay.create({ data: { userId: cam.id, date: first, status: "PRESENT" } }));
    const url = `/api/attendance/month?userId=${cam.id}`;
    check(((await json(await x.fetch(url))).days ?? []).length >= 1, "a founder can read a colleague's attendance");
    await prisma.user.update({ where: { id: exFounder.id }, data: { role: "EMPLOYEE" } });
    check(((await json(await x.fetch(url))).days ?? []).length === 0, "demoted, the same session loses that at once (not when the token expires)");
    await prisma.user.update({ where: { id: exFounder.id }, data: { isActive: false } });
    check((await x.fetch("/api/notifications")).status === 401, "deactivated, the session is refused at once");
    if (!existing) await prisma.attendanceDay.delete({ where: { id: day.id } });
  } finally {
    await prisma.lead.deleteMany({ where: { id: { in: cleanup.leadIds } } });
    await prisma.user.deleteMany({ where: { id: { in: cleanup.userIds } } });
    await prisma.$disconnect();
  }

  console.log(`\n${checks - failures}/${checks} checks passed`);
  if (failures) process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
