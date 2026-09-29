#!/usr/bin/env node
/**
 * notifytest — Phase 8 acceptance: every listed notification fires, reaches
 * exactly the right people, and respects permissions and preferences.
 *
 *   Events (the founder's list): task assigned · new project · deadline
 *   approaching · task overdue · new client message · new report · new
 *   invoice · payment received · payment overdue · project update · founder
 *   announcement.
 *
 *   Plus: role-aware delivery (billing never reaches staff below the
 *   founder; one client never sees another's), preferences and their
 *   minimums, the notification center's filters, and the email channel —
 *   delivered through a local Resend stand-in, with the daily digest.
 *
 *   SMOKE_BASE=http://localhost:3000 npm run notifytest
 */

import { createServer } from "node:http";
import { randomUUID } from "node:crypto";

import bcrypt from "bcryptjs";

import { loadEnv, Session, waitForServer } from "./smoke.mjs";

loadEnv();

const SEED_PASSWORD = process.env.SEED_PASSWORD ?? "advertisex-change-me";
const FOUNDER = "coachd@bwm.local";
const LEAD = "tayyaba@bwm.local"; // Osteria Nonna's account lead
const MARK = `P8n${Date.now().toString(36)}`;
const PASSWORD = `${MARK}-Notify!pass`;

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
const send = (session, url, method, body, headers = {}) =>
  session.fetch(url, { method, headers: { "Content-Type": "application/json", ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
const dayKey = (d, tz = "America/New_York") => new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
const plusDays = (n) => {
  const d = new Date(`${dayKey(new Date())}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

async function invited(inviter, endpoint, body) {
  const res = await send(inviter, endpoint, "POST", body);
  const out = await json(res);
  if (res.status !== 201) throw new Error(`invite: ${res.status} ${JSON.stringify(out)}`);
  const accept = await send(new Session("anon"), "/api/invites/accept", "POST", { token: out.link.split("/").pop(), name: body.name, password: PASSWORD });
  if (accept.status !== 201) throw new Error(`accept: ${accept.status}`);
  const s = new Session(body.name);
  await s.signIn(body.email, PASSWORD);
  return s;
}

async function main() {
  await waitForServer();
  const { PrismaClient } = await import("@prisma/client");
  const prisma = new PrismaClient();
  await prisma.user.updateMany({ where: { email: { in: [FOUNDER, LEAD] } }, data: { mustChangePassword: false } });
  const since = new Date();
  const [clientA, clientB] = await Promise.all(["Osteria Nonna", "Bao Society"].map((businessName) => prisma.client.findFirst({ where: { businessName }, select: { id: true, organizationId: true, departmentId: true } })));
  const org = await prisma.organization.findUniqueOrThrow({ where: { id: clientA.organizationId } });
  const founderUser = await prisma.user.findUnique({ where: { email: FOUNDER }, select: { id: true } });
  const leadUser = await prisma.user.findUnique({ where: { email: LEAD }, select: { id: true, notificationPrefs: true } });
  const otherDept = await prisma.department.findFirst({ where: { id: { not: clientA.departmentId }, organizationId: org.id }, select: { id: true } });
  const outsider = await prisma.user.create({
    data: { organizationId: org.id, name: `${MARK} Outsider`, email: `${MARK.toLowerCase()}.out@advertisex.example`, passwordHash: await bcrypt.hash(SEED_PASSWORD, 10), role: "MANAGER", jobTitle: "Other department", departments: { create: { departmentId: otherDept.id, roleInDept: "LEAD" } } },
  });
  const emails = { a: `${MARK.toLowerCase()}.a@osterianonna.example`, b: `${MARK.toLowerCase()}.b@baosociety.example` };
  const made = { tasks: [], projects: [], invoices: [], reports: [], announcements: [] };

  // Everything a person received since the run started, by type.
  const got = async (userId, type, extra = {}) => prisma.notification.count({ where: { userId, type, createdAt: { gte: since }, ...extra } });

  try {
    const founder = new Session("founder");
    await founder.signIn(FOUNDER, SEED_PASSWORD);
    const lead = new Session("lead");
    await lead.signIn(LEAD, SEED_PASSWORD);
    const a = await invited(founder, `/api/clients/${clientA.id}/portal-users`, { name: `${MARK} Owner A`, email: emails.a, clientRole: "OWNER" });
    await invited(founder, `/api/clients/${clientB.id}/portal-users`, { name: `${MARK} Owner B`, email: emails.b, clientRole: "OWNER" });
    const ownerA = await prisma.user.findUnique({ where: { email: emails.a }, select: { id: true } });
    const ownerB = await prisma.user.findUnique({ where: { email: emails.b }, select: { id: true } });

    console.log("\nTHE FOUNDER'S EVENT LIST");
    // 1. Task assigned
    const task = await json(await send(founder, "/api/tasks", "POST", { departmentId: clientA.departmentId, clientId: clientA.id, title: `${MARK} brief the photographer`, assigneeId: leadUser.id, dueAt: plusDays(1) }));
    if (task.task) made.tasks.push(task.task.id);
    check((await got(leadUser.id, "TASK_ASSIGNED")) >= 1, "task assigned → the assignee is told");

    // 2. New project
    const project = await json(await send(founder, "/api/projects", "POST", { clientId: clientA.id, title: `${MARK} Brunch launch`, serviceIds: [], startDate: plusDays(0), deadline: plusDays(20), ownerId: leadUser.id }));
    if (project.project) made.projects.push(project.project.id);
    check((await got(leadUser.id, "PROJECT_CREATED")) >= 1, "new project → its owner is told");

    // 3 & 4. Deadline approaching (due by the end of today), task overdue (the morning sweep)
    const soon = await json(await send(founder, "/api/tasks", "POST", { departmentId: clientA.departmentId, clientId: clientA.id, title: `${MARK} due today`, assigneeId: leadUser.id, dueAt: plusDays(0) }));
    if (soon.task) made.tasks.push(soon.task.id);
    const late = await json(await send(founder, "/api/tasks", "POST", { departmentId: clientA.departmentId, clientId: clientA.id, title: `${MARK} overdue thing`, assigneeId: leadUser.id, dueAt: plusDays(-2) }));
    if (late.task) made.tasks.push(late.task.id);
    const { sweepTaskDeadlines } = await import("../modules/tasks/deadlines.ts");
    await sweepTaskDeadlines(new Date(), "America/New_York", dayKey(new Date()));
    check((await got(leadUser.id, "DUE_TOMORROW", { title: { contains: MARK } })) >= 1, "deadline approaching → the assignee is told");
    check((await got(leadUser.id, "OVERDUE", { title: { contains: MARK } })) >= 1, "task overdue → the assignee is told");

    // 5. New client message
    const threads = (await json(await a.fetch("/api/messages/threads"))).threads ?? [];
    const teamThread = threads.find((t) => t.kind === "TEAM");
    const msg = new FormData();
    msg.set("body", `${MARK} can we move the shoot?`);
    await a.fetch(`/api/messages/threads/${teamThread.id}`, { method: "POST", body: msg });
    check((await got(leadUser.id, "MESSAGE_RECEIVED", { body: { contains: MARK } })) >= 1, "new client message → the account team is told");

    // 6. New report (drafted → reviewers; published → the client)
    // The month before last: clear of the monthly job's month and of reporttest's.
    const lastMonth = (() => {
      let [y, m] = dayKey(new Date()).slice(0, 7).split("-").map(Number);
      for (let i = 0; i < 2; i++) {
        m -= 1;
        if (m === 0) {
          m = 12;
          y -= 1;
        }
      }
      return `${y}-${String(m).padStart(2, "0")}`;
    })();
    await prisma.clientReport.deleteMany({ where: { clientId: clientA.id, periodMonth: lastMonth, generated: true, status: "DRAFT" } });
    const gen = await json(await send(founder, `/api/clients/${clientA.id}/reports/generate`, "POST", { month: lastMonth, regenerate: true }));
    const reportId = gen.report?.id;
    if (gen.created) made.reports.push(reportId);
    check((await got(leadUser.id, "REPORT_READY")) >= 1 && (await got(founderUser.id, "REPORT_READY")) >= 1, "report drafted → the account lead and founders are asked to review it");
    check((await got(ownerA.id, "REPORT_SHARED")) === 0, "…and the client hears nothing yet");
    if (gen.report?.status !== "PUBLISHED") await send(founder, `/api/clients/${clientA.id}/reports/${reportId}/review`, "POST", { action: "approve" });
    check((await got(ownerA.id, "REPORT_SHARED")) >= 1, "report published → the client is told");

    // 7, 8, 9. New invoice, payment received, payment overdue
    const inv = await json(await send(founder, "/api/invoices", "POST", { clientId: clientA.id, currency: org.currency, dueDate: plusDays(14), lines: [{ description: `${MARK} work`, quantity: "1", rate: "100.00" }] }));
    made.invoices.push(inv.invoice.id);
    await founder.fetch(`/api/invoices/${inv.invoice.id}/send`, { method: "POST" });
    check((await got(ownerA.id, "INVOICE_SENT")) >= 1, "new invoice → the client's owner is told");
    await send(founder, `/api/invoices/${inv.invoice.id}/payments`, "POST", { amount: "40.00", method: "CASH", paidAt: plusDays(0) }, { "Idempotency-Key": randomUUID() });
    check((await got(ownerA.id, "PAYMENT_RECEIVED")) >= 1, "payment received → the client is thanked");
    await prisma.invoice.update({ where: { id: inv.invoice.id }, data: { dueDate: new Date(`${plusDays(-5)}T00:00:00Z`) } });
    await founder.fetch("/api/invoices/sweep", { method: "POST" });
    check((await got(ownerA.id, "INVOICE_OVERDUE")) >= 1 && (await got(founderUser.id, "INVOICE_OVERDUE")) >= 1, "payment overdue → the client and the founders are told");

    // 10. Project update (team) and a shared update (client)
    await send(founder, `/api/projects/${project.project.id}`, "PATCH", { deadline: plusDays(25) });
    check((await got(leadUser.id, "PROJECT_UPDATED")) >= 1, "project changed → its team is told");
    await send(founder, `/api/projects/${project.project.id}/updates`, "POST", { title: `${MARK} Shoot booked`, body: "Friday at 10.", visibility: "CLIENT" });
    check((await got(ownerA.id, "UPDATE_SHARED")) >= 1, "update shared → the client is told");

    // 11. Founder announcement
    const ann = await json(await send(founder, "/api/announcements", "POST", { title: `${MARK} Holiday hours`, body: "We close early on Friday.", audience: "EVERYONE" }));
    made.announcements.push(ann.announcement?.id);
    check(ann.announcement?.recipients >= 3, "announcement → everyone is told", JSON.stringify(ann));
    check((await got(ownerA.id, "ANNOUNCEMENT")) === 1 && (await got(leadUser.id, "ANNOUNCEMENT")) === 1, "a client and a team member each get it once");
    const teamOnly = await json(await send(founder, "/api/announcements", "POST", { title: `${MARK} Team lunch`, body: "Thursday, 1pm.", audience: "TEAM" }));
    made.announcements.push(teamOnly.announcement?.id);
    check((await got(ownerA.id, "ANNOUNCEMENT", { title: { contains: "Team lunch" } })) === 0 && (await got(leadUser.id, "ANNOUNCEMENT", { title: { contains: "Team lunch" } })) === 1, "a team announcement never reaches clients");
    check((await send(lead, "/api/announcements", "POST", { title: "Nope", body: "Not allowed", audience: "EVERYONE" })).status === 403, "only the founder can announce");

    console.log("\nPERMISSIONS");
    check((await got(ownerB.id, "INVOICE_SENT")) + (await got(ownerB.id, "REPORT_SHARED")) + (await got(ownerB.id, "UPDATE_SHARED")) + (await got(ownerB.id, "PAYMENT_RECEIVED")) === 0, "client B receives none of client A's events");
    check((await got(outsider.id, "PROJECT_UPDATED")) + (await got(outsider.id, "MESSAGE_RECEIVED")) + (await got(outsider.id, "REPORT_READY")) === 0, "a manager of another department receives none of them");
    check((await got(leadUser.id, "INVOICE_SENT")) + (await got(leadUser.id, "PAYMENT_RECEIVED")) + (await got(leadUser.id, "INVOICE_OVERDUE")) === 0, "the account lead (an employee) receives no billing");
    const { notify } = await import("../lib/notifications.ts");
    check((await notify({ userId: leadUser.id, type: "INVOICE_SENT", title: `${MARK} leak`, body: "x" })) === false && (await got(leadUser.id, "INVOICE_SENT")) === 0, "notify() itself refuses billing to an employee, whatever the caller does");
    check((await notify({ userId: ownerA.id, type: "TASK_ASSIGNED", title: `${MARK} leak`, body: "x" })) === false, "and team work to a client");

    console.log("\nPREFERENCES");
    const prefs = await json(await a.fetch("/api/me/notifications"));
    check(prefs.categories?.some((c) => c.key === "billing") && !prefs.categories?.some((c) => c.key === "tasks"), "a client sees only the categories it can receive");
    const muted = await json(await send(a, "/api/me/notifications", "PATCH", { levels: { messages: "off", billing: "off", announcements: "off" } }));
    check(muted.levels?.messages === "off" && muted.levels?.billing === "app" && muted.levels?.announcements === "app", "messages can be muted; billing and announcements can't go below in-app");
    const before = await got(ownerA.id, "MESSAGE_RECEIVED");
    const reply = new FormData();
    reply.set("body", `${MARK} sure`);
    await lead.fetch(`/api/messages/threads/${teamThread.id}`, { method: "POST", body: reply });
    check((await got(ownerA.id, "MESSAGE_RECEIVED")) === before, "a muted category isn't delivered");
    await send(a, "/api/me/notifications", "PATCH", { levels: { messages: "email", billing: "email" }, digest: true });

    console.log("\nTHE NOTIFICATION CENTER");
    const all = await json(await a.fetch("/api/notifications?page=1"));
    const billing = await json(await a.fetch("/api/notifications?page=1&category=billing"));
    check(all.total >= 5 && billing.notifications?.length >= 3 && billing.notifications.every((n) => n.category === "billing"), "the center filters by category", `${all.total} / ${billing.notifications?.length}`);
    const unreadOnly = await json(await a.fetch("/api/notifications?page=1&unread=1"));
    check(unreadOnly.notifications.every((n) => !n.readAt) && unreadOnly.total === all.unread, "and by unread");
    await a.fetch(`/api/notifications/${all.notifications[0].id}`, { method: "PATCH" });
    check((await json(await a.fetch("/api/notifications?page=1&unread=1"))).total === all.unread - 1, "opening one marks it read");
    check((await a.fetch(`/api/notifications/${(await prisma.notification.findFirst({ where: { userId: leadUser.id } })).id}`, { method: "PATCH" })).status === 403, "no one can mark someone else's");
    check((await a.fetch("/portal/notifications")).status === 200 && (await lead.fetch("/notifications")).status === 200, "both centers open");

    console.log("\nEMAIL (a local Resend stand-in)");
    const inbox = [];
    const server = createServer((req, res) => {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        inbox.push({ path: req.url, auth: req.headers.authorization, body: JSON.parse(body || "{}") });
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ id: `email_${inbox.length}` }));
      });
    });
    await new Promise((r) => server.listen(0, r));
    Object.assign(process.env, { RESEND_API_KEY: "re_test", EMAIL_FROM: "Advertise X <hello@advertisex.example>", RESEND_BASE_URL: `http://127.0.0.1:${server.address().port}` });
    try {
      const delivered = await notify({ userId: ownerA.id, type: "INVOICE_SENT", title: `${MARK} Invoice INV-9999`, body: "$100.00 — view it in your portal.", href: `/portal/invoices/${inv.invoice.id}` });
      const row = await prisma.notification.findFirst({ where: { userId: ownerA.id, title: `${MARK} Invoice INV-9999` } });
      check(delivered && row?.emailState === "SENT" && row.emailedAt, "a billing notice at 'email' level is emailed and marked SENT", row?.emailState);
      const mail = inbox.find((m) => m.body.subject === `${MARK} Invoice INV-9999`);
      check(mail?.path === "/emails" && mail.auth === "Bearer re_test" && mail.body.to?.[0] === emails.a && mail.body.html.includes("/portal/invoices/"), "Resend receives it: to the right person, with the link");
      await send(a, "/api/me/notifications", "PATCH", { levels: { billing: "app" } });
      const quiet = await notify({ userId: ownerA.id, type: "INVOICE_SENT", title: `${MARK} Quiet invoice`, body: "x" });
      const quietRow = await prisma.notification.findFirst({ where: { userId: ownerA.id, title: `${MARK} Quiet invoice` } });
      check(quiet && quietRow?.emailState === null && !inbox.some((m) => m.body.subject === `${MARK} Quiet invoice`), "at 'in the app' level, no email is sent");
      const { sendDailyDigests } = await import("../lib/notifications.ts");
      const digest = await sendDailyDigests(new Date(Date.now() + 60_000));
      const digestMail = inbox.find((m) => m.body.subject?.startsWith("Your Advertise X digest") && m.body.to?.[0] === emails.a);
      check(digest.sent >= 1 && digestMail && digestMail.body.text.includes(MARK), "the daily digest goes to people who asked for it, listing what they haven't opened");
      check(!inbox.some((m) => m.body.subject?.startsWith("Your Advertise X digest") && m.body.to?.[0] === emails.b), "and not to people who didn't");
    } finally {
      server.close();
      for (const k of ["RESEND_API_KEY", "EMAIL_FROM", "RESEND_BASE_URL"]) delete process.env[k];
    }
  } finally {
    const ids = (await prisma.user.findMany({ where: { email: { in: [...Object.values(emails), outsider.email] } }, select: { id: true } })).map((u) => u.id);
    await prisma.notification.deleteMany({ where: { OR: [{ userId: { in: ids } }, { title: { contains: MARK } }, { body: { contains: MARK } }, { createdAt: { gte: since }, userId: { in: [leadUser.id, founderUser.id] } }] } });
    await prisma.announcement.deleteMany({ where: { title: { contains: MARK } } });
    await prisma.invoice.deleteMany({ where: { id: { in: made.invoices } } });
    for (const id of made.reports) {
      const r = await prisma.clientReport.findUnique({ where: { id }, select: { fileId: true } });
      if (r) await prisma.file.delete({ where: { id: r.fileId } }).catch(() => null);
    }
    await prisma.task.deleteMany({ where: { id: { in: made.tasks } } });
    await prisma.project.deleteMany({ where: { id: { in: made.projects } } });
    await prisma.message.deleteMany({ where: { OR: [{ authorId: { in: ids } }, { body: { contains: MARK } }] } });
    await prisma.threadRead.deleteMany({ where: { userId: { in: ids } } });
    await prisma.clientInvite.deleteMany({ where: { email: { contains: MARK.toLowerCase() } } });
    await prisma.user.update({ where: { id: leadUser.id }, data: { notificationPrefs: leadUser.notificationPrefs } });
    await prisma.user.deleteMany({ where: { id: { in: ids } } });
    await prisma.$disconnect();
  }

  console.log(`\n${checks - failures}/${checks} checks passed`);
  if (failures) {
    console.error(`✗ ${failures} failed`);
    process.exit(1);
  }
  console.log("✓ every listed notification fires, to exactly the right people, as they asked");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
