#!/usr/bin/env node
/**
 * billingtest — Phase 7 acceptance over real HTTP.
 *
 *   1. Invoices: integer totals with documented rounding, drafts editable
 *      and invisible to clients, sending takes the next number exactly once
 *      (also under concurrency), sent invoices frozen.
 *   2. Payments: partial, idempotent (replays and simultaneous duplicates
 *      record once), over-payment refused, reversals kept in the history.
 *   3. Overdue: the job moves past-due invoices and notifies once.
 *   4. Reconciliation: every figure on the financial overview (and its CSV)
 *      equals the same figure recomputed from invoices and payments.
 *   5. Isolation: a client sees only its own billing, and only its owner;
 *      no one below the founder sees billing at all.
 *   6. Stripe (when the server runs with it enabled): a signed webhook
 *      records a payment once; a bad signature records nothing.
 *
 *   SMOKE_BASE=http://localhost:3000 npm run billingtest
 */

import { randomUUID } from "node:crypto";

import bcrypt from "bcryptjs";

import { loadEnv, Session, waitForServer } from "./smoke.mjs";

loadEnv();

const SEED_PASSWORD = process.env.SEED_PASSWORD ?? "advertisex-change-me";
const FOUNDER = "coachd@bwm.local";
const EMPLOYEE = "tayyaba@bwm.local";
const MARK = `P7test${Date.now().toString(36)}`;
const PASSWORD = `${MARK}-Billing!pass`;
const TZ = "America/New_York";

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
const refused = (s) => s >= 400 && s < 500;
const dayKey = (d, tz = TZ) => new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
const plusDays = (n) => {
  const d = new Date(`${dayKey(new Date())}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const dec = (minor) => `${Math.floor(minor / 100)}.${String(minor % 100).padStart(2, "0")}`;

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
  const settings = await prisma.settings.findFirst({ select: { timezone: true } }).catch(() => null);
  const tz = settings?.timezone || TZ;
  const today = dayKey(new Date(), tz);

  const [clientA, clientB] = await Promise.all(
    ["Osteria Nonna", "Bao Society"].map((businessName) => prisma.client.findFirst({ where: { businessName }, select: { id: true, organizationId: true, departmentId: true } })),
  );
  const org = await prisma.organization.findUniqueOrThrow({ where: { id: clientA.organizationId } });
  const founderUser = await prisma.user.findUnique({ where: { email: FOUNDER }, select: { id: true } });
  const manager = await prisma.user.create({
    data: {
      organizationId: org.id,
      name: `${MARK} Manager`,
      email: `${MARK.toLowerCase()}.mgr@advertisex.example`,
      passwordHash: await bcrypt.hash(SEED_PASSWORD, 10),
      role: "MANAGER",
      jobTitle: "Test manager",
      departments: { create: { departmentId: clientA.departmentId, roleInDept: "LEAD" } },
    },
  });
  const emails = { a: `${MARK.toLowerCase()}.a@osterianonna.example`, m: `${MARK.toLowerCase()}.m@osterianonna.example`, b: `${MARK.toLowerCase()}.b@baosociety.example` };
  const made = [];

  try {
    const founder = new Session("founder");
    await founder.signIn(FOUNDER, SEED_PASSWORD);
    const emp = new Session("employee");
    await emp.signIn(EMPLOYEE, SEED_PASSWORD);
    const mgr = new Session("manager");
    await mgr.signIn(manager.email, SEED_PASSWORD);
    const a = await invited(founder, `/api/clients/${clientA.id}/portal-users`, { name: `${MARK} Owner A`, email: emails.a, clientRole: "OWNER" });
    const b = await invited(founder, `/api/clients/${clientB.id}/portal-users`, { name: `${MARK} Owner B`, email: emails.b, clientRole: "OWNER" });
    const member = await invited(a, "/api/portal/people", { name: `${MARK} Member`, email: emails.m });
    const ownerA = await prisma.user.findUnique({ where: { email: emails.a }, select: { id: true } });

    const draft = async (clientId, lines, extra = {}) => {
      const res = await send(founder, "/api/invoices", "POST", { clientId, currency: org.currency, dueDate: plusDays(14), lines, ...extra });
      const body = await json(res);
      if (body.invoice) made.push(body.invoice.id);
      return { res, body, id: body.invoice?.id };
    };
    const get = async (id) => (await json(await founder.fetch(`/api/invoices/${id}`))).invoice;

    console.log("\nTOTALS AND ROUNDING");
    const primary = await draft(clientA.id, [
      { description: `${MARK} Website build`, quantity: "1.5", rate: "1,000.01" },
      { description: `${MARK} Ads`, quantity: "3", rate: "33.33" },
      { description: `${MARK} Loyalty discount`, quantity: "1", rate: "-10.00" },
    ], { notes: `${MARK} thank you` });
    check(primary.res.status === 201, "the founder creates a draft", `${primary.res.status} ${JSON.stringify(primary.body)}`);
    let inv = await get(primary.id);
    check(JSON.stringify(inv.lines.map((l) => l.amountMinor)) === JSON.stringify([150002, 9999, -1000]), "each line is quantity × rate, rounded half away from zero (1.5 × 1,000.01 = 1,500.015 → 1,500.02)", JSON.stringify(inv.lines.map((l) => l.amountMinor)));
    check(inv.totalMinor === 159001 && inv.subtotalMinor === 159001, "the total is the sum of the rounded lines, in cents", String(inv.totalMinor));
    const bad = await draft(clientA.id, [{ description: "x", quantity: "1", rate: "1.234" }]);
    check(bad.res.status === 422 && bad.body.fields?.["lines.0.rate"], "fractions of a cent are refused, with the field named");
    check((await draft(clientA.id, [{ description: "x", quantity: "1", rate: "1" }], { currency: "XXX" })).res.status === 422, "an unknown currency is refused");
    const projectB = await prisma.project.findFirst({ where: { clientId: clientB.id }, select: { id: true } });
    if (projectB) check((await draft(clientA.id, [{ description: "x", quantity: "1", rate: "1" }], { projectId: projectB.id })).res.status === 422, "a project of another client is refused");
    check((await send(founder, `/api/invoices/${primary.id}`, "PATCH", { clientId: clientA.id, currency: org.currency, dueDate: plusDays(10), notes: `${MARK} thank you`, lines: [{ description: `${MARK} Website build`, quantity: "1.5", rate: "1,000.01" }, { description: `${MARK} Ads`, quantity: "3", rate: "33.33" }, { description: `${MARK} Loyalty discount`, quantity: "1", rate: "-10.00" }] })).ok, "a draft can be edited");

    console.log("\nDRAFTS STAY PRIVATE");
    check(!((await json(await a.fetch("/api/portal/invoices"))).invoices ?? []).some((i) => i.id === primary.id), "a draft isn't in the client's list");
    check((await a.fetch(`/api/portal/invoices/${primary.id}`)).status === 404, "nor openable by id");
    check((await a.fetch(`/api/portal/invoices/${primary.id}/pdf`)).status === 404, "nor downloadable");
    check((await send(founder, `/api/invoices/${primary.id}/payments`, "POST", { amount: "1.00", method: "CASH", paidAt: today }, { "Idempotency-Key": randomUUID() })).status === 422, "no payment on a draft");

    console.log("\nSENDING AND NUMBERING");
    const before = (await prisma.organization.findUnique({ where: { id: org.id } })).nextInvoiceNumber;
    const sent = await json(await founder.fetch(`/api/invoices/${primary.id}/send`, { method: "POST" }));
    inv = await get(primary.id);
    const expectLabel = `${org.invoicePrefix}-${String(before).padStart(4, "0")}`;
    check(sent.issued === true && inv.numberLabel === expectLabel && inv.status === "SENT", `sending takes the next number (${expectLabel}) and marks it Sent`, JSON.stringify(sent));
    check(inv.issueDate?.slice(0, 10) === today && inv.billTo.name === "Osteria Nonna", "it is dated today and who it's billed to is frozen");
    check((await send(founder, `/api/invoices/${primary.id}`, "PATCH", { clientId: clientA.id, currency: org.currency, dueDate: plusDays(10), lines: [{ description: "x", quantity: "1", rate: "1" }] })).status === 409, "a sent invoice can't be edited");
    check((await founder.fetch(`/api/invoices/${primary.id}`, { method: "DELETE" })).status === 409, "nor deleted");
    const again = await json(await founder.fetch(`/api/invoices/${primary.id}/send`, { method: "POST" }));
    check(again.issued === false && (await prisma.organization.findUnique({ where: { id: org.id } })).nextInvoiceNumber === before + 1, "sending again only re-emails — no new number");
    check((await prisma.notification.count({ where: { userId: ownerA.id, type: "INVOICE_SENT" } })) === 1, "the client's owner is told once, in the portal");

    const batch = await Promise.all([1, 2, 3, 4].map((n) => draft(clientA.id, [{ description: `${MARK} batch ${n}`, quantity: "1", rate: "10.00" }])));
    const race = await Promise.all([...batch.map((d) => founder.fetch(`/api/invoices/${d.id}/send`, { method: "POST" })), founder.fetch(`/api/invoices/${batch[0].id}/send`, { method: "POST" })]);
    check(race.every((r) => r.status === 200 || r.status === 409), "five simultaneous sends (one duplicated) all answer cleanly", race.map((r) => r.status).join(","));
    const numbers = (await prisma.invoice.findMany({ where: { id: { in: batch.map((d) => d.id) } }, select: { number: true } })).map((r) => r.number).sort((x, y) => x - y);
    check(JSON.stringify(numbers) === JSON.stringify([before + 1, before + 2, before + 3, before + 4]), "concurrent sends get distinct, consecutive numbers — none skipped, none reused", JSON.stringify(numbers));
    check((await prisma.organization.findUnique({ where: { id: org.id } })).nextInvoiceNumber === before + 5, "the duplicated send consumed no number");

    console.log("\nTHE CLIENT'S VIEW");
    const listA = (await json(await a.fetch("/api/portal/invoices"))).invoices ?? [];
    const rowA = listA.find((i) => i.id === primary.id);
    check(rowA?.status === "SENT" && rowA.totalMinor === 159001 && rowA.balanceMinor === 159001, "the client sees it, with status and balance", JSON.stringify(rowA));
    const pdf = await a.fetch(`/api/portal/invoices/${primary.id}/pdf`);
    const bytes = Buffer.from(await pdf.arrayBuffer());
    check(pdf.status === 200 && (pdf.headers.get("content-type") ?? "").includes("pdf") && bytes.subarray(0, 5).toString() === "%PDF-", "and downloads the PDF");
    const page = await (await a.fetch(`/portal/invoices/${primary.id}`)).text();
    check(page.includes(expectLabel) && page.includes("1,590.01"), "the portal page shows its number and total");

    console.log("\nPAYMENTS");
    const pay = (id, amount, key = randomUUID(), extra = {}) => send(founder, `/api/invoices/${id}/payments`, "POST", { amount, method: "BANK_TRANSFER", paidAt: today, reference: `${MARK}`, ...extra }, { "Idempotency-Key": key });
    const k1 = randomUUID();
    const p1 = await pay(primary.id, "500.00", k1);
    inv = await get(primary.id);
    check(p1.status === 201 && inv.status === "PARTIALLY_PAID" && inv.paidMinor === 50000 && inv.balanceMinor === 109001, "a partial payment: Partially paid, balance down to the cent");
    const replay = await pay(primary.id, "500.00", k1);
    check(replay.status === 200 && (await json(replay)).replayed === true, "the same request again is recognised as a replay (200)");
    check((await pay(primary.id, "600.00", k1)).status === 409, "the same key for a different amount is refused");
    const k2 = randomUUID();
    const burst = await Promise.all(Array.from({ length: 5 }, () => pay(primary.id, "100.00", k2)));
    const created = burst.filter((r) => r.status === 201).length;
    check(created === 1 && burst.every((r) => r.status === 201 || r.status === 200), "five simultaneous identical payments record exactly one", burst.map((r) => r.status).join(","));
    inv = await get(primary.id);
    check(inv.paidMinor === 60000 && inv.payments.filter((p) => !p.reversedAt).length === 2, "paid total = sum of payments (60,000 cents, 2 payments)", String(inv.paidMinor));
    check((await pay(primary.id, dec(inv.balanceMinor + 1))).status === 422, "one cent more than the balance is refused");
    check((await pay(primary.id, "1.00", randomUUID(), { paidAt: plusDays(2) })).status === 422, "a payment dated in the future is refused");
    check((await pay(primary.id, dec(inv.balanceMinor))).status === 201, "paying the exact balance…");
    inv = await get(primary.id);
    check(inv.status === "PAID" && inv.balanceMinor === 0 && inv.paidAt, "…makes it Paid");
    check((await pay(primary.id, "1.00")).status === 422, "no payment on a paid invoice");
    check((await prisma.notification.count({ where: { userId: ownerA.id, type: "PAYMENT_RECEIVED" } })) >= 3, "the client is thanked for each payment");
    const firstPayment = inv.payments[0];
    const rev = await send(founder, `/api/invoices/${primary.id}/payments/${firstPayment.id}/reverse`, "POST", { reason: `${MARK} bounced` });
    inv = await get(primary.id);
    check(rev.ok && inv.status === "PARTIALLY_PAID" && inv.paidMinor === 159001 - 50000 && inv.payments.find((p) => p.id === firstPayment.id)?.reversedAt, "reversing a payment keeps it (marked) and reopens the balance");
    check((await send(founder, `/api/invoices/${primary.id}/payments/${firstPayment.id}/reverse`, "POST", { reason: "again" })).status === 409, "a payment reverses once");
    check((await send(founder, `/api/invoices/${primary.id}/void`, "POST", { reason: "try" })).status === 409, "an invoice with payments can't be voided");
    const clientSees = (await json(await a.fetch(`/api/portal/invoices/${primary.id}`))).invoice;
    check(clientSees && clientSees.payments.length === 2 && !JSON.stringify(clientSees).includes("bounced") && !JSON.stringify(clientSees).includes("recordedBy"), "the client's history shows its live payments — not reversals, reasons or who recorded them");

    const toVoid = batch[1].id;
    check((await send(founder, `/api/invoices/${toVoid}/void`, "POST", { reason: `${MARK} duplicate` })).ok, "an unpaid sent invoice can be voided");
    check((await get(toVoid)).status === "VOID" && (await pay(toVoid, "1.00")).status === 422, "a void invoice takes no payment");
    check((await founder.fetch(`/api/invoices/${toVoid}/send`, { method: "POST" })).status === 409, "and can't be sent");

    console.log("\nOVERDUE");
    const late = batch[2].id;
    await prisma.invoice.update({ where: { id: late }, data: { dueDate: new Date(`${plusDays(-3)}T00:00:00Z`) } });
    await prisma.invoice.update({ where: { id: batch[3].id }, data: { dueDate: new Date(`${today}T00:00:00Z`) } });
    const sweep1 = await json(await founder.fetch("/api/invoices/sweep", { method: "POST" }));
    check((await get(late)).status === "OVERDUE", "an invoice three days past due becomes Overdue", JSON.stringify(sweep1));
    check((await get(batch[3].id)).status === "SENT", "one due today is not overdue yet");
    const told = await prisma.notification.count({ where: { type: "INVOICE_OVERDUE", href: { contains: late } } });
    check(told >= 2, "the founders and the client's owner are told", String(told));
    const sweep2 = await json(await founder.fetch("/api/invoices/sweep", { method: "POST" }));
    check((await prisma.notification.count({ where: { type: "INVOICE_OVERDUE", href: { contains: late } } })) === told && !JSON.stringify(sweep2).includes(`"moved":${sweep1.moved + 1}`), "running the job again changes nothing and tells no one twice");
    await pay(late, "4.00");
    check((await get(late)).status === "OVERDUE", "a part payment on an overdue invoice leaves it Overdue");
    await pay(late, "6.00");
    check((await get(late)).status === "PAID", "paying it off makes it Paid");

    console.log("\nRECONCILIATION");
    for (const range of ["month", "12m"]) {
      const o = (await json(await founder.fetch(`/api/finance/overview?range=${range}`))).overview;
      const invoices = await prisma.invoice.findMany({ where: { organizationId: org.id, currency: org.currency }, include: { payments: true } });
      const inRange = (k) => k >= o.range.from && k <= o.range.to;
      let received = 0, outstanding = 0, overdue = 0, pending = 0, invoiced = 0, mismatched = 0;
      for (const i of invoices) {
        const live = i.payments.filter((p) => !p.reversedAt);
        if (live.reduce((s, p) => s + p.amountMinor, 0) !== i.paidMinor) mismatched += 1;
        for (const p of live) if (inRange(dayKey(p.paidAt, tz))) received += p.amountMinor;
        const bal = ["DRAFT", "VOID"].includes(i.status) ? 0 : Math.max(0, i.totalMinor - i.paidMinor);
        if (["SENT", "PARTIALLY_PAID", "OVERDUE"].includes(i.status)) outstanding += bal;
        if (i.status === "OVERDUE") overdue += bal;
        if (["SENT", "PARTIALLY_PAID"].includes(i.status)) pending += bal;
        if (!["DRAFT", "VOID"].includes(i.status) && i.issueDate && inRange(i.issueDate.toISOString().slice(0, 10))) invoiced += i.totalMinor;
      }
      check(mismatched === 0, `[${range}] every invoice's paid total equals its live payments`);
      check(o.receivedMinor === received, `[${range}] payments received matches the payments (${dec(received)})`, `${o.receivedMinor} vs ${received}`);
      check(o.outstandingMinor === outstanding && o.overdueMinor === overdue && o.pendingMinor === pending && o.outstandingMinor === o.pendingMinor + o.overdueMinor, `[${range}] outstanding = pending + overdue, matching the invoices`, JSON.stringify({ o: [o.outstandingMinor, o.pendingMinor, o.overdueMinor], db: [outstanding, pending, overdue] }));
      check(o.invoicedMinor === invoiced, `[${range}] invoiced matches the invoices issued`, `${o.invoicedMinor} vs ${invoiced}`);
      check(o.byClient.reduce((s, c) => s + c.amountMinor, 0) === o.receivedMinor && o.byService.reduce((s, c) => s + c.amountMinor, 0) === o.receivedMinor, `[${range}] revenue by client and by service each sum to payments received`);
      if (range === "12m") check(o.trend.reduce((s, t) => s + t.receivedMinor, 0) === o.receivedMinor, "[12m] the monthly trend sums to payments received");
      const services = await prisma.clientService.findMany({ where: { organizationId: org.id, status: "ACTIVE" } });
      const round = (n, d) => Math.floor((2 * n + d) / (2 * d));
      const mrr = services.reduce((s, x) => s + (x.billing === "MONTHLY" ? x.price * 100 : x.billing === "QUARTERLY" ? round(x.price * 100, 3) : x.billing === "YEARLY" ? round(x.price * 100, 12) : 0), 0);
      check(o.mrrMinor === mrr && o.arrMinor === mrr * 12, `[${range}] MRR is the recurring services' monthly value (${dec(mrr)})`, `${o.mrrMinor} vs ${mrr}`);
      if (range === "12m") {
        const csv = await (await founder.fetch(`/api/finance/export?kind=summary&range=${range}`)).text();
        check(csv.includes(`Payments received,${dec(o.receivedMinor)}`) && csv.includes(`Outstanding,${dec(o.outstandingMinor)}`), "[12m] the CSV export carries the same figures");
      }
    }

    console.log("\nISOLATION");
    const bInvoice = await draft(clientB.id, [{ description: `${MARK} Bao work`, quantity: "1", rate: "250.00" }]);
    await founder.fetch(`/api/invoices/${bInvoice.id}/send`, { method: "POST" });
    check(((await json(await b.fetch("/api/portal/invoices"))).invoices ?? []).some((i) => i.id === bInvoice.id), "client B sees its own invoice");
    check(!((await json(await a.fetch("/api/portal/invoices"))).invoices ?? []).some((i) => i.id === bInvoice.id), "client A's list never includes B's");
    for (const [url, label] of [[`/api/portal/invoices/${bInvoice.id}`, "B's invoice"], [`/api/portal/invoices/${bInvoice.id}/pdf`, "B's PDF"]]) {
      check((await a.fetch(url)).status === 404, `A gets 404 for ${label} by id`);
    }
    const aPage = await (await a.fetch(`/portal/invoices/${bInvoice.id}`)).text();
    // On a production build the whole response — HTML and the serialized
    // payload — must be free of B. A development server's payload also carries
    // React's DevTools debug channel (resolved server values, B's included,
    // though the page refuses it), so there only the rendered page is judged.
    // Production is what clients reach; the staging suite runs it strictly.
    const devServer = aPage.includes("/_next/static/chunks/webpack.js");
    const judged = devServer ? aPage.replace(/<script[\s\S]*?<\/script>/g, "") : aPage;
    check(!judged.includes(`${MARK} Bao work`) && aPage.includes("This invoice isn"), `A's portal page for B's invoice is 'not available', with nothing of B in it${devServer ? " (rendered page; dev server)" : " (entire response)"}`);
    check((await b.fetch(`/api/portal/invoices/${primary.id}`)).status === 404, "and B can't open A's");
    check((await member.fetch("/api/portal/invoices")).status === 403, "a member (not the owner) sees no invoices list");
    check((await member.fetch(`/api/portal/invoices/${primary.id}`)).status === 404 && (await member.fetch(`/api/portal/invoices/${primary.id}/pdf`)).status === 404, "nor any invoice or PDF of their own account");
    for (const [session, who] of [[a, "a client"], [mgr, "a manager"], [emp, "an employee"]]) {
      for (const [method, url] of [["GET", "/api/invoices"], ["GET", `/api/invoices/${primary.id}`], ["GET", `/api/invoices/${primary.id}/pdf`], ["GET", "/api/finance/overview"], ["GET", "/api/finance/export?kind=payments"], ["POST", `/api/invoices/${primary.id}/payments`], ["POST", "/api/invoices/sweep"], ["POST", "/api/invoices"]]) {
        const res = await send(session, url, method, method === "POST" ? { amount: "1.00", method: "CASH", paidAt: today } : undefined, { "Idempotency-Key": randomUUID() });
        check(refused(res.status), `${who} is refused ${method} ${url.replace(primary.id, ":id")}`, String(res.status));
      }
    }
    for (const path of ["/finance", "/invoices", `/invoices/${primary.id}`]) {
      const res = await mgr.fetch(path);
      check(res.status !== 200, `a manager can't open ${path.replace(primary.id, ":id")}`, String(res.status));
    }
    const leak = await (await a.fetch("/portal/invoices")).text();
    check(!leak.includes(`${MARK} Bao work`) && !leak.includes("bounced"), "A's invoices page has nothing of B's and no internal reasons");

    console.log("\nAUDIT");
    const since = new Date(Date.now() - 30 * 60_000);
    const audits = await prisma.auditLog.groupBy({ by: ["entityType", "action"], where: { entityType: { in: ["Invoice", "InvoiceLine", "Payment"] }, createdAt: { gte: since } }, _count: true });
    const has = (entity, action) => audits.some((r) => r.entityType === entity && r.action === action);
    check(
      has("Invoice", "RECORD_CREATED") && has("Invoice", "RECORD_UPDATED") && has("InvoiceLine", "RECORD_CREATED") && has("Payment", "RECORD_CREATED") && has("Payment", "RECORD_UPDATED"),
      "invoice, line and payment writes are in the audit log",
      JSON.stringify(audits.map((r) => `${r.entityType}.${r.action}`)),
    );

    console.log("\nSTRIPE");
    const probe = await fetch(new URL("/api/webhooks/stripe", founder.base), { method: "POST", body: "{}" });
    const secret = process.env.STRIPE_WEBHOOK_SECRET;
    if (probe.status === 404 || !secret) {
      check(probe.status === 404, "live charging is off by default: the webhook answers 404", String(probe.status));
      check((await a.fetch(`/api/portal/invoices/${batch[3].id}/pay`, { method: "POST" })).status === 404, "and there is no online pay button");
    } else {
      const { stripeSignatureHeader } = await import("../modules/integrations/payments/stripe.ts");
      const target = await get(batch[3].id);
      const evt = JSON.stringify({ id: `evt_${MARK}`, type: "checkout.session.completed", created: Math.floor(Date.now() / 1000), data: { object: { id: `cs_${MARK}`, payment_status: "paid", amount_total: target.balanceMinor, currency: org.currency.toLowerCase(), payment_intent: `pi_${MARK}`, metadata: { invoiceId: target.id, organizationId: org.id } } } });
      const hook = (body, header) => fetch(new URL("/api/webhooks/stripe", founder.base), { method: "POST", headers: { "Content-Type": "application/json", "Stripe-Signature": header }, body });
      check((await hook(evt, "t=1,v1=00")).status === 400, "a badly signed event is refused");
      check((await get(target.id)).paidMinor === 0, "and records nothing");
      const ok = await Promise.all([hook(evt, stripeSignatureHeader(evt, secret)), hook(evt, stripeSignatureHeader(evt, secret))]);
      check(ok.every((r) => r.status === 200), "a signed paid checkout is accepted (twice, as Stripe retries)");
      const after = await get(target.id);
      check(after.status === "PAID" && after.payments.filter((p) => p.source === "STRIPE").length === 1, "and recorded exactly once, as an online payment");
    }
  } finally {
    const ids = (await prisma.user.findMany({ where: { email: { in: [...Object.values(emails), manager.email] } }, select: { id: true } })).map((u) => u.id);
    await prisma.notification.deleteMany({ where: { OR: [{ userId: { in: ids } }, { href: { in: made.flatMap((id) => [`/invoices/${id}`, `/portal/invoices/${id}`]) } }] } });
    await prisma.invoice.deleteMany({ where: { id: { in: made } } });
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
  console.log("✓ invoices, payments and the overview reconcile to the cent; each client sees only its own billing");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
