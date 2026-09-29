#!/usr/bin/env node
/**
 * reporttest — Phase 8 acceptance: a monthly report generates end-to-end for
 * a seeded client and appears in the portal — after, and only after, a
 * person has reviewed it.
 *
 *   SMOKE_BASE=http://localhost:3000 npm run reporttest
 */


import { loadEnv, Session, waitForServer } from "./smoke.mjs";

loadEnv();
// The jobs this script runs may queue AI-employee work (Phase 9 automations);
// the server's worker runs it, never this process.
process.env.AGENT_WORKER = "off";

const SEED_PASSWORD = process.env.SEED_PASSWORD ?? "advertisex-change-me";
const FOUNDER = "coachd@bwm.local";
const EMPLOYEE = "cam@bwm.local";
const MARK = `P8r${Date.now().toString(36)}`;
const PASSWORD = `${MARK}-Report!pass`;

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
const dayKey = (d) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
const prevMonth = (month) => {
  const [y, m] = month.split("-").map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
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
  await prisma.user.updateMany({ where: { email: { in: [FOUNDER, EMPLOYEE] } }, data: { mustChangePassword: false } });
  const [clientA, clientB] = await Promise.all(["Osteria Nonna", "Bao Society"].map((businessName) => prisma.client.findFirst({ where: { businessName }, select: { id: true, organizationId: true, departmentId: true } })));
  const month = prevMonth(dayKey(new Date()).slice(0, 7));
  const emails = { a: `${MARK.toLowerCase()}.a@osterianonna.example`, b: `${MARK.toLowerCase()}.b@baosociety.example` };
  const created = [];
  const project = await prisma.project.findFirst({ where: { clientId: clientA.id }, select: { id: true } });
  const internal = project ? await prisma.projectUpdate.create({ data: { projectId: project.id, title: `${MARK}-INTERNAL-update`, body: `${MARK}-INTERNAL-body`, visibility: "INTERNAL" } }) : null;

  try {
    const founder = new Session("founder");
    await founder.signIn(FOUNDER, SEED_PASSWORD);
    const emp = new Session("employee");
    await emp.signIn(EMPLOYEE, SEED_PASSWORD);
    const a = await invited(founder, `/api/clients/${clientA.id}/portal-users`, { name: `${MARK} Owner A`, email: emails.a, clientRole: "OWNER" });
    const b = await invited(founder, `/api/clients/${clientB.id}/portal-users`, { name: `${MARK} Owner B`, email: emails.b, clientRole: "OWNER" });

    console.log("\nGENERATE");
    // A clean month for the run: an earlier generated draft for it is set aside.
    const prior = await prisma.clientReport.findMany({ where: { clientId: clientA.id, periodMonth: month, generated: true }, select: { id: true, fileId: true, status: true } });
    for (const p of prior) await prisma.file.delete({ where: { id: p.fileId } });
    check((await send(emp, `/api/clients/${clientA.id}/reports/generate`, "POST", { month })).status >= 400, "an employee can't generate a client report");
    const gen = await send(founder, `/api/clients/${clientA.id}/reports/generate`, "POST", { month });
    const out = await json(gen);
    const id = out.report?.id;
    if (id) created.push(id);
    check(gen.status === 201 && out.report.reviewState === "NEEDS_REVIEW" && out.report.status === "DRAFT", "the founder generates last month's report: a draft that needs review", `${gen.status} ${JSON.stringify(out)}`);
    const again = await send(founder, `/api/clients/${clientA.id}/reports/generate`, "POST", { month });
    check(again.status === 200 && (await json(again)).report.id === id, "generating the same month again returns the same report");
    const staff = (await json(await founder.fetch(`/api/clients/${clientA.id}/reports/${id}`))).report;
    const data = staff.data;
    check(data?.clientName === "Osteria Nonna" && data.month === month && data.channels.length >= 1 && data.highlights.length >= 1, "it holds the month's results by channel, with highlights", JSON.stringify({ channels: data?.channels?.length, highlights: data?.highlights?.length }));
    check(Array.isArray(data.projects) && data.projects.every((p) => typeof p.progress === "number"), "and project progress");
    check(typeof staff.summary === "string" && staff.summary.length > 60 && ["AI", "TEMPLATE"].includes(staff.summarySource), `a summary is written (${staff.summarySource})`);

    // The figures are the stored results, not invented: spot-check each channel's headline against the database.
    const rows = await prisma.metricValue.findMany({ where: { clientId: clientA.id, periodStart: new Date(`${month}-01T00:00:00.000Z`) } });
    const rank = (s) => ["MANUAL", "GOOGLE_ADS", "META_ADS", "GA4", "SEARCH_CONSOLE", "GOOGLE_BUSINESS_PROFILE", "MOCK"].indexOf(s);
    let matched = 0;
    for (const ch of data.channels) {
      for (const m of ch.metrics.filter((x) => !x.derived && x.value !== null)) {
        const best = rows.filter((r) => r.metricKey === `${ch.channel}.${m.key}`).sort((x, y) => rank(x.source) - rank(y.source))[0];
        if (best && best.value === m.value) matched += 1;
        else check(false, `${ch.channel}.${m.key} matches the stored value`, `${m.value} vs ${best?.value}`);
      }
    }
    check(matched > 0, `every figure in the report equals the stored result (${matched} checked)`);
    check(!JSON.stringify(data).includes(`${MARK}-INTERNAL`) && !staff.summary.includes(`${MARK}-INTERNAL`), "nothing internal is in it");

    console.log("\nNOT BEFORE REVIEW");
    check(!((await json(await a.fetch("/api/portal/reports"))).reports ?? []).some((r) => r.id === id), "the draft isn't in the client's library");
    check((await a.fetch(`/api/portal/reports/${id}`)).status === 404 && (await send(a, `/api/portal/reports/${id}/open`, "POST", {})).status === 404, "nor openable by id");
    check((await send(founder, `/api/clients/${clientA.id}/reports/${id}`, "PATCH", { status: "PUBLISHED" })).status === 409, "the library's plain Publish refuses a report that hasn't been reviewed");
    check((await send(emp, `/api/clients/${clientA.id}/reports/${id}/review`, "POST", { action: "approve" })).status >= 400, "an employee can't approve it");

    console.log("\nREVIEW");
    check((await send(founder, `/api/clients/${clientA.id}/reports/${id}/review`, "POST", { action: "revise", summary: "Too short" })).status === 422, "a too-short summary is refused");
    const fileBefore = await prisma.file.findUnique({ where: { id: (await prisma.clientReport.findUnique({ where: { id } })).fileId } });
    const edited = `${MARK} — August was a steady month. Your ads kept bringing in bookings, the website team finished the design stage, and next we move on to building the menu and booking pages. Thank you for your quick feedback this month.`;
    check((await send(founder, `/api/clients/${clientA.id}/reports/${id}/review`, "POST", { action: "revise", summary: edited })).ok, "the reviewer edits the summary");
    const afterEdit = await prisma.clientReport.findUnique({ where: { id }, include: { file: true } });
    check(afterEdit.summary === edited && afterEdit.summarySource === "EDITED" && afterEdit.reviewState === "NEEDS_REVIEW", "it's saved as an edit, still awaiting approval");
    check(afterEdit.file.storedName !== fileBefore.storedName, "and the PDF is re-rendered with it");
    check((await send(founder, `/api/clients/${clientA.id}/reports/${id}/review`, "POST", { action: "approve" })).ok, "the founder approves it");
    const approved = await prisma.clientReport.findUnique({ where: { id }, include: { file: true } });
    check(approved.status === "PUBLISHED" && approved.reviewState === "APPROVED" && approved.reviewedById && approved.file.visibility === "CLIENT", "approval publishes it, records who reviewed it, and shares the file");
    check((await prisma.notification.count({ where: { user: { email: emails.a }, type: "REPORT_SHARED" } })) === 1, "the client is told");

    console.log("\nIN THE PORTAL");
    const lib = (await json(await a.fetch("/api/portal/reports"))).reports ?? [];
    const row = lib.find((r) => r.id === id);
    check(row?.inApp === true && row.unread === true, "it's in the client's library, unread, with an in-app view");
    const view = (await json(await a.fetch(`/api/portal/reports/${id}`))).report;
    check(view?.summary === edited && view.data.channels.length === data.channels.length, "the in-app report shows the reviewed summary and the same figures");
    check(((await json(await a.fetch("/api/portal/reports"))).reports ?? []).find((r) => r.id === id)?.unread === false, "reading it marks it read");
    const page = await (await a.fetch(`/portal/reports/${id}`)).text();
    check(page.includes(MARK) && page.includes("Osteria Nonna") && !page.includes(`${MARK}-INTERNAL`), "the portal page renders it, with nothing internal");
    const link = (await json(await send(a, `/api/portal/reports/${id}/open`, "POST", { disposition: "attachment" }))).url;
    const pdf = link ? await fetch(new URL(link, a.base)) : null;
    const bytes = pdf ? Buffer.from(await pdf.arrayBuffer()) : Buffer.alloc(0);
    check(pdf?.status === 200 && bytes.subarray(0, 5).toString() === "%PDF-" && bytes.length > 1500, "the branded PDF downloads", `${pdf?.status} ${bytes.length} ${bytes.subarray(0, 60).toString()} ${link}`);

    console.log("\nISOLATION");
    check((await b.fetch(`/api/portal/reports/${id}`)).status === 404 && (await send(b, `/api/portal/reports/${id}/open`, "POST", {})).status === 404, "another client can't open it");
    check(!(await (await b.fetch(`/portal/reports/${id}`)).text()).includes("Osteria Nonna"), "nor see it on the page");
    check((await a.fetch(`/api/clients/${clientA.id}/reports/${id}`)).status >= 400, "a client can't use the team's report API");

    console.log("\nTHE MONTHLY JOB");
    const { runMonthlyReports } = await import("../modules/monthly-reports/server.ts");
    const firstOfMonth = new Date(`${dayKey(new Date()).slice(0, 7)}-02T15:00:00Z`);
    const run1 = await runMonthlyReports(firstOfMonth);
    const run2 = await runMonthlyReports(firstOfMonth);
    check(run1.status === "ok" && run1.month === month, `early in the month it drafts last month's reports (${run1.created} new)`);
    check(run2.created === 0, "running it again creates nothing");
    const drafts = await prisma.clientReport.findMany({ where: { periodMonth: month, generated: true, status: "DRAFT" }, select: { id: true, reviewState: true } });
    check(drafts.every((d) => d.reviewState === "NEEDS_REVIEW"), "everything it drafts waits for review");
    for (const d of drafts) if (!created.includes(d.id)) created.push(d.id);
    const midMonth = await runMonthlyReports(new Date(`${dayKey(new Date()).slice(0, 7)}-15T15:00:00Z`));
    check(midMonth.status === "skipped", "mid-month it does nothing");
  } finally {
    for (const id of created) {
      const r = await prisma.clientReport.findUnique({ where: { id }, select: { fileId: true } });
      if (r) await prisma.file.delete({ where: { id: r.fileId } }).catch(() => null);
    }
    if (internal) await prisma.projectUpdate.delete({ where: { id: internal.id } }).catch(() => null);
    const ids = (await prisma.user.findMany({ where: { email: { in: Object.values(emails) } }, select: { id: true } })).map((u) => u.id);
    await prisma.notification.deleteMany({ where: { OR: [{ userId: { in: ids } }, { title: { contains: "report ready for review" }, createdAt: { gte: new Date(Date.now() - 3600_000) } }] } });
    await prisma.clientInvite.deleteMany({ where: { email: { contains: MARK.toLowerCase() } } });
    await prisma.threadRead.deleteMany({ where: { userId: { in: ids } } });
    await prisma.user.deleteMany({ where: { id: { in: ids } } });
    await prisma.$disconnect();
  }

  console.log(`\n${checks - failures}/${checks} checks passed`);
  if (failures) {
    console.error(`✗ ${failures} failed`);
    process.exit(1);
  }
  console.log("✓ a monthly report generates, is reviewed, and reaches the client's portal — and nowhere else");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
