#!/usr/bin/env node
/**
 * portaltest — Phase 6 acceptance over real HTTP.
 *
 *   1. Invite-only: a login exists only by accepting an invitation, is bound
 *      to exactly one client account, and the link works once.
 *   2. Isolation: client A can't read or write client B's projects, files,
 *      reports, invoices or messages — by list, by direct id, or by URL —
 *      and can't reach any staff API.
 *   3. Internal content never reaches the portal: internal updates,
 *      comments, files, milestone notes, tasks, client notes, credentials
 *      and draft reports are absent from every portal page and API response.
 *   4. Messaging: the private founder channel is the founder's alone; the
 *      team sees its TEAM threads; unread counts, read receipts, files and
 *      notifications work.
 *   5. Roles inside an account: a MEMBER sees no billing and invites no one.
 *
 *   SMOKE_BASE=http://localhost:3000 npm run portaltest
 */

import bcrypt from "bcryptjs";

import { loadEnv, Session, waitForServer } from "./smoke.mjs";

loadEnv();

const SEED_PASSWORD = process.env.SEED_PASSWORD ?? "advertisex-change-me";
const FOUNDER = "coachd@bwm.local";
const ASSIGNEE = "tayyaba@bwm.local"; // Osteria Nonna's account lead
const MARK = `P6test${Date.now().toString(36)}`;
const PASSWORD = `${MARK}-Portal!pass`;

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
const send = (session, url, method, body) =>
  session.fetch(url, { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
const pdf = (name) => new File([Buffer.from(`%PDF-1.4\n% ${name}\n%%EOF\n`)], name, { type: "application/pdf" });
const refused = (status) => status >= 400 && status < 500;

/** Invites someone through the given endpoint, accepts, and signs them in. */
async function invited(inviter, endpoint, { name, email, clientRole }) {
  const res = await send(inviter, endpoint, "POST", clientRole ? { name, email, clientRole } : { name, email });
  const body = await json(res);
  if (res.status !== 201) throw new Error(`invite via ${endpoint}: ${res.status} ${JSON.stringify(body)}`);
  const token = body.link.split("/").pop();
  const anon = new Session(`${name}-anon`);
  const accept = await send(anon, "/api/invites/accept", "POST", { token, name, password: PASSWORD });
  if (accept.status !== 201) throw new Error(`accept for ${email}: ${accept.status} ${JSON.stringify(await json(accept))}`);
  const session = new Session(name);
  await session.signIn(email, PASSWORD);
  return { session, token };
}

async function main() {
  await waitForServer();
  const { PrismaClient } = await import("@prisma/client");
  const prisma = new PrismaClient();
  await prisma.user.updateMany({ where: { email: { in: [FOUNDER, ASSIGNEE] } }, data: { mustChangePassword: false } });

  const [clientA, clientB] = await Promise.all(
    ["Osteria Nonna", "Bao Society"].map((businessName) =>
      prisma.client.findFirst({ where: { businessName }, select: { id: true, organizationId: true, departmentId: true, clientAccountId: true } }),
    ),
  );
  const founderUser = await prisma.user.findUnique({ where: { email: FOUNDER }, select: { id: true } });
  const assigneeUser = await prisma.user.findUnique({ where: { email: ASSIGNEE }, select: { id: true } });

  // A manager of Osteria Nonna's department: sees its TEAM thread, never the founders' channel.
  const manager = await prisma.user.create({
    data: {
      organizationId: clientA.organizationId,
      name: `${MARK} Manager`,
      email: `${MARK.toLowerCase()}.mgr@advertisex.example`,
      passwordHash: await bcrypt.hash(SEED_PASSWORD, 10),
      role: "MANAGER",
      jobTitle: "Test manager",
      departments: { create: { departmentId: clientA.departmentId, roleInDept: "LEAD" } },
    },
  });

  const emails = {
    a: `${MARK.toLowerCase()}.a@osterianonna.example`,
    member: `${MARK.toLowerCase()}.m@osterianonna.example`,
    b: `${MARK.toLowerCase()}.b@baosociety.example`,
  };
  const made = { projects: [], files: [], reports: [], updates: [], comments: [], tasks: [], milestones: [], notes: [], credentials: [] };

  try {
    const founder = new Session("founder");
    await founder.signIn(FOUNDER, SEED_PASSWORD);
    const team = new Session("assignee");
    await team.signIn(ASSIGNEE, SEED_PASSWORD);
    const mgr = new Session("manager");
    await mgr.signIn(manager.email, SEED_PASSWORD);

    console.log("\nINVITE-ONLY LOGINS");
    const anonAccept = await send(new Session("anon"), "/api/invites/accept", "POST", { token: "x".repeat(32), name: "Nobody", password: PASSWORD });
    check(anonAccept.status === 410, "a made-up invitation token is refused", `${anonAccept.status}`);
    const { session: a, token: tokenA } = await invited(founder, `/api/clients/${clientA.id}/portal-users`, { name: `${MARK} Owner A`, email: emails.a, clientRole: "OWNER" });
    const { session: b } = await invited(founder, `/api/clients/${clientB.id}/portal-users`, { name: `${MARK} Owner B`, email: emails.b, clientRole: "OWNER" });
    const userA = await prisma.user.findUnique({ where: { email: emails.a } });
    const accountA = (await prisma.client.findUnique({ where: { id: clientA.id }, select: { clientAccountId: true } })).clientAccountId;
    const accountB = (await prisma.client.findUnique({ where: { id: clientB.id }, select: { clientAccountId: true } })).clientAccountId;
    check(userA.role === "CLIENT" && userA.clientRole === "OWNER" && userA.clientAccountId === accountA, "accepting creates a CLIENT owner bound to exactly that account");
    check(accountA !== accountB, "the two restaurants are separate accounts");
    const reuse = await send(new Session("again"), "/api/invites/accept", "POST", { token: tokenA, name: "Again", password: PASSWORD });
    check(reuse.status === 410, "an invitation link works once", `${reuse.status}`);
    const clientInvites = await send(a, `/api/clients/${clientA.id}/portal-users`, "POST", { name: "Sneaky", email: `${MARK}.x@example.com`, clientRole: "OWNER" });
    check(refused(clientInvites.status), "a client can't use the staff invitation endpoint", `${clientInvites.status}`);
    const landing = await a.fetch("/portal");
    check(landing.status === 200, "the new login lands in its portal", `${landing.status}`);
    const staffPage = await a.fetch("/dashboard");
    check(landing.status === 200 && staffPage.status !== 200, "and can't open the team's pages", `${staffPage.status}`);

    console.log("\nCLIENT B'S THINGS");
    let projectB = await prisma.project.findFirst({ where: { clientId: clientB.id }, select: { id: true } });
    if (!projectB) {
      const created = await json(await send(founder, "/api/projects", "POST", { clientId: clientB.id, title: `${MARK} Bao project`, serviceIds: [], startDate: new Date().toISOString().slice(0, 10), deadline: new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10) }));
      projectB = created.project;
      made.projects.push(projectB.id);
    }
    const fileFormB = new FormData();
    fileFormB.set("projectId", projectB.id);
    fileFormB.set("visibility", "CLIENT");
    fileFormB.set("file", pdf(`${MARK}-b-shared.pdf`));
    const fileB = (await json(await founder.fetch("/api/files", { method: "POST", body: fileFormB }))).file;
    made.files.push(fileB.id);
    const reportFormB = new FormData();
    reportFormB.set("file", pdf(`${MARK}-b-report.pdf`));
    reportFormB.set("title", `${MARK} Bao report`);
    reportFormB.set("kind", "MONTHLY");
    reportFormB.set("periodMonth", "2026-08");
    reportFormB.set("publish", "true");
    const repB = await founder.fetch(`/api/clients/${clientB.id}/reports`, { method: "POST", body: reportFormB });
    const reportB = (await json(repB)).report;
    check(repB.status === 201 && reportB, "the founder publishes a report to client B", `${repB.status}`);
    made.reports.push(reportB.id);
    const threadsB = (await json(await b.fetch("/api/messages/threads"))).threads ?? [];
    check(threadsB.length === 2 && threadsB.every((t) => t.client.id === clientB.id), "client B has its two threads: the team and the founders", `${threadsB.length}`);
    const teamB = threadsB.find((t) => t.kind === "TEAM");
    const postB = new FormData();
    postB.set("body", `${MARK} secret from B`);
    postB.set("file", pdf(`${MARK}-b-attachment.pdf`));
    check((await b.fetch(`/api/messages/threads/${teamB.id}`, { method: "POST", body: postB })).status === 201, "client B writes to its team with a file");
    const attachmentB = (await json(await b.fetch(`/api/messages/threads/${teamB.id}`))).messages.find((m) => m.body.includes(MARK)).files[0];
    made.files.push(attachmentB.id);

    console.log("\nISOLATION — A AGAINST B");
    const titleB = (await prisma.project.findUnique({ where: { id: projectB.id }, select: { title: true } })).title;
    // With the portal's loading boundary the page streams, so Next answers 200
    // with the not-found view; what matters is that it is that view, and bare of B.
    const notFoundFor = async (session, id) => {
      const res = await session.fetch(`/portal/projects/${id}`);
      const html = await res.text();
      return (res.status === 404 || html.includes("This project isn") ) && !html.includes(titleB);
    };
    check(await notFoundFor(a, projectB.id), "B's project page is 'not available' for A, with nothing of B in it");
    check((await a.fetch(`/api/portal/projects/${projectB.id}`)).status === 404, "B's project API is a 404 for A");
    check((await send(a, `/api/portal/reports/${reportB.id}/open`, "POST", {})).status === 404, "A can't open B's report by id");
    check(!((await json(await a.fetch("/api/portal/reports"))).reports ?? []).some((r) => r.id === reportB.id), "B's report isn't in A's library");
    const filesList = await a.fetch(`/api/files?projectId=${projectB.id}`);
    check(refused(filesList.status) || ((await json(filesList)).files ?? []).length === 0, "A can't list B's project files", `${filesList.status}`);
    check((await a.fetch(`/api/files/${fileB.id}`)).status === 404, "A can't download B's file by id");
    check((await a.fetch(`/api/files/${attachmentB.id}`)).status === 404, "A can't download B's message attachment by id");
    check((await send(a, `/api/files/${fileB.id}`, "PATCH", { visibility: "INTERNAL" })).status >= 400, "A can't change B's file");
    check((await a.fetch(`/api/messages/threads/${teamB.id}`)).status === 404, "A can't read B's thread by id");
    const intrude = new FormData();
    intrude.set("body", "intrusion");
    check((await a.fetch(`/api/messages/threads/${teamB.id}`, { method: "POST", body: intrude })).status === 404, "A can't post into B's thread");
    check((await a.fetch(`/api/messages/threads?clientId=${clientB.id}`)).status === 404, "A can't ask for B's threads by client id");
    const threadsA = (await json(await a.fetch("/api/messages/threads"))).threads ?? [];
    check(threadsA.length === 2 && threadsA.every((t) => t.client.id === clientA.id), "A's thread list is A's alone");
    check(!(await (await a.fetch("/portal/messages")).text()).includes(`${MARK} secret from B`), "B's message never renders in A's portal");
    const invoicesA = await json(await a.fetch("/api/portal/invoices"));
    check(Array.isArray(invoicesA.invoices) && invoicesA.invoices.length === 0, "invoices: A sees only its own (none until billing)");
    const peopleA = await json(await a.fetch("/api/portal/people"));
    check((peopleA.users ?? []).every((u) => !u.email.endsWith("baosociety.example")), "A's people are A's alone");
    for (const [url, label] of [
      [`/api/projects/${projectB.id}`, "B's project (staff API)"],
      [`/api/projects/${projectB.id}/comments`, "B's project comments"],
      [`/api/projects/${projectB.id}/updates`, "B's project updates"],
      [`/api/clients/${clientB.id}`, "B's client record"],
      [`/api/clients/${clientB.id}/credentials`, "B's credentials"],
      [`/api/clients/${clientB.id}/reports`, "B's reports (staff API)"],
      [`/api/clients/${clientB.id}/portal-users`, "B's portal users"],
      ["/api/clients", "the client list"],
      ["/api/projects", "the project list"],
    ]) {
      const res = await a.fetch(url);
      check(refused(res.status), `A is refused ${label}`, `${res.status}`);
    }
    check((await b.fetch(`/api/files/${attachmentB.id}`)).status === 200, "B itself can download its attachment (the refusals above are isolation, not breakage)");

    console.log("\nINTERNAL CONTENT STAYS INTERNAL");
    const projectA = await prisma.project.findFirst({ where: { clientId: clientA.id }, orderBy: { createdAt: "asc" }, select: { id: true } });
    const secret = (k) => `${MARK}-INTERNAL-${k}`;
    const shared = (k) => `${MARK}-SHARED-${k}`;
    const upd = async (title, visibility) => (await json(await send(founder, `/api/projects/${projectA.id}/updates`, "POST", { title, body: `${title} body`, visibility }))).update;
    for (const u of [await upd(secret("update"), "INTERNAL"), await upd(shared("update"), "CLIENT")]) if (u) made.updates.push(u.id);
    check(made.updates.length === 2, "the founder posts an internal and a shared update");
    for (const [body, visibility] of [[secret("comment"), "INTERNAL"], [shared("comment"), "CLIENT"]]) {
      const c = (await json(await send(founder, `/api/projects/${projectA.id}/comments`, "POST", { body, visibility }))).comment;
      if (c) made.comments.push(c.id);
    }
    check(made.comments.length === 2, "and an internal and a shared comment");
    const empShare = await send(team, `/api/projects/${projectA.id}/updates`, "POST", { title: `${MARK} emp`, body: "x", visibility: "CLIENT" });
    check(empShare.status === 403, "an employee can't share an update with the client", `${empShare.status}`);
    for (const [name, visibility] of [[`${secret("file")}.pdf`, "INTERNAL"], [`${shared("file")}.pdf`, "CLIENT"]]) {
      const form = new FormData();
      form.set("projectId", projectA.id);
      form.set("visibility", visibility);
      form.set("file", pdf(name));
      const f = (await json(await founder.fetch("/api/files", { method: "POST", body: form }))).file;
      if (f) made.files.push(f.id);
    }
    const ms = (await json(await send(founder, `/api/projects/${projectA.id}/milestones`, "POST", { title: shared("milestone"), description: secret("milestone-note"), weight: 1 }))).milestone;
    if (ms) made.milestones.push(ms.id);
    const task = (await json(await send(founder, "/api/tasks", "POST", { projectId: projectA.id, title: secret("task") }))).task;
    if (task) made.tasks.push(task.id);
    const note = await prisma.clientNote.create({ data: { organizationId: clientA.organizationId, clientId: clientA.id, authorId: founderUser.id, body: secret("client-note"), pinned: true } });
    made.notes.push(note.id);
    const cred = (await json(await send(founder, `/api/clients/${clientA.id}/credentials`, "POST", { label: secret("credential"), kind: "WEBSITE", username: secret("username"), secret: secret("password") }))).credential;
    if (cred) made.credentials.push(cred.id);
    const draftForm = new FormData();
    draftForm.set("file", pdf(`${secret("draft-report-file")}.pdf`));
    draftForm.set("title", secret("draft-report"));
    draftForm.set("kind", "CAMPAIGN");
    draftForm.set("periodMonth", "2026-08");
    draftForm.set("publish", "false");
    const draft = (await json(await founder.fetch(`/api/clients/${clientA.id}/reports`, { method: "POST", body: draftForm }))).report;
    if (draft) made.reports.push(draft.id);
    check(Boolean(ms && task && cred && draft), "plus a milestone note, a task, a client note, a credential and a draft report");

    // Everything the portal can show, as pages and as API responses.
    const threadIdsA = threadsA.map((t) => t.id);
    const surfaces = [
      "/portal",
      "/portal/projects",
      `/portal/projects/${projectA.id}`,
      "/portal/reports",
      "/portal/messages",
      "/portal/invoices",
      "/portal/settings",
      `/api/portal/projects/${projectA.id}`,
      "/api/portal/reports",
      "/api/portal/invoices",
      "/api/portal/me",
      "/api/portal/people",
      "/api/messages/threads",
      `/api/files?projectId=${projectA.id}`,
      ...threadIdsA.map((id) => `/api/messages/threads/${id}`),
    ];
    let everything = "";
    for (const url of surfaces) {
      const res = await a.fetch(url);
      const text = await res.text();
      everything += text;
      const leaked = text.includes(`${MARK}-INTERNAL-`);
      check(res.status === 200 && !leaked, `${url}: nothing internal`, leaked ? text.slice(Math.max(0, text.indexOf(`${MARK}-INTERNAL-`) - 60), text.indexOf(`${MARK}-INTERNAL-`) + 80) : `${res.status}`);
    }
    check(!everything.includes("Portal!pass") && !everything.includes("passwordHash") && !everything.includes("tokenHash"), "no password or token material anywhere in the portal");
    for (const k of ["update", "comment", "file", "milestone"]) check(everything.includes(shared(k)), `the shared ${k} does appear`);
    check((await a.fetch(`/api/projects/${projectA.id}/comments`)).status === 404, "A can't read its own project's raw comment stream (internal notes live there)");
    check((await a.fetch(`/api/projects/${projectA.id}/updates`)).status === 404, "nor the raw updates list");
    const updRow = await prisma.projectUpdate.findUnique({ where: { id: made.updates[0] } });
    await send(founder, `/api/projects/${projectA.id}/updates/${updRow.id}`, "PATCH", { visibility: "CLIENT" });
    check((await (await a.fetch(`/portal/projects/${projectA.id}`)).text()).includes(secret("update")), "sharing an internal update later makes it appear — the flag decides");
    await send(founder, `/api/projects/${projectA.id}/updates/${updRow.id}`, "PATCH", { visibility: "INTERNAL" });
    check(!(await (await a.fetch(`/portal/projects/${projectA.id}`)).text()).includes(secret("update")), "and making it internal again removes it");

    console.log("\nREPORTS");
    const libraryA = (await json(await a.fetch("/api/portal/reports"))).reports ?? [];
    check(!libraryA.some((r) => r.id === draft?.id), "a draft report isn't in the client's library");
    const pubForm = new FormData();
    pubForm.set("file", pdf(`${MARK}-a-report.pdf`));
    pubForm.set("title", shared("report"));
    pubForm.set("kind", "MONTHLY");
    pubForm.set("periodMonth", "2026-08");
    pubForm.set("publish", "true");
    const pubA = (await json(await founder.fetch(`/api/clients/${clientA.id}/reports`, { method: "POST", body: pubForm }))).report;
    made.reports.push(pubA.id);
    const notified = await prisma.notification.count({ where: { userId: userA.id, type: "REPORT_SHARED" } });
    check(notified >= 1, "publishing a report tells the client");
    const before = ((await json(await a.fetch("/api/portal/reports"))).reports ?? []).find((r) => r.id === pubA.id);
    check(before?.unread === true, "a new report shows as unread", JSON.stringify(before));
    const opened = await json(await send(a, `/api/portal/reports/${pubA.id}/open`, "POST", { disposition: "attachment" }));
    const got = opened.url ? await fetch(new URL(opened.url, a.base)) : null;
    check(got?.status === 200 && (got.headers.get("content-type") ?? "").includes("pdf"), "opening it hands back a working signed link", `${got?.status}`);
    const after = ((await json(await a.fetch("/api/portal/reports"))).reports ?? []).find((r) => r.id === pubA.id);
    check(after?.unread === false, "and it's read afterwards");
    const readBy = ((await json(await founder.fetch(`/api/clients/${clientA.id}/reports`))).reports ?? []).find((r) => r.id === pubA.id)?.readBy ?? [];
    check(readBy.includes(`${MARK} Owner A`), "the team sees who opened it");
    await send(founder, `/api/clients/${clientA.id}/reports/${pubA.id}`, "PATCH", { status: "DRAFT" });
    check((await send(a, `/api/portal/reports/${pubA.id}/open`, "POST", {})).status === 404, "a withdrawn report can't be opened any more");

    console.log("\nMESSAGING");
    const teamA = threadsA.find((t) => t.kind === "TEAM");
    const founderA = threadsA.find((t) => t.kind === "FOUNDER");
    const say = async (session, threadId, body) => {
      const f = new FormData();
      f.set("body", body);
      return (await session.fetch(`/api/messages/threads/${threadId}`, { method: "POST", body: f })).status;
    };
    check((await say(a, teamA.id, `${MARK} hello team`)) === 201, "the client writes to the team");
    check((await prisma.notification.count({ where: { userId: assigneeUser.id, type: "MESSAGE_RECEIVED", body: { contains: MARK } } })) >= 1, "the account lead is notified");
    const teamList = (await json(await team.fetch(`/api/messages/threads?clientId=${clientA.id}`))).threads ?? [];
    check(teamList.find((t) => t.id === teamA.id)?.unread >= 1, "and sees it unread");
    await team.fetch(`/api/messages/threads/${teamA.id}`);
    const teamList2 = (await json(await team.fetch(`/api/messages/threads?clientId=${clientA.id}`))).threads ?? [];
    check(teamList2.find((t) => t.id === teamA.id)?.unread === 0, "reading clears the unread count");
    const receipt = (await json(await a.fetch(`/api/messages/threads/${teamA.id}`))).messages.find((m) => m.body === `${MARK} hello team`);
    check(receipt?.seenBy?.length >= 1, "the client sees a read receipt", JSON.stringify(receipt?.seenBy));
    check((await say(team, teamA.id, `${MARK} hello back`)) === 201, "the team replies");
    check((await prisma.notification.count({ where: { userId: userA.id, type: "MESSAGE_RECEIVED", body: { contains: MARK } } })) >= 1, "and the client is notified");
    await send(a, "/api/portal/me", "PATCH", { prefs: { messages: false, reports: true, updates: true } });
    const beforeMuted = await prisma.notification.count({ where: { userId: userA.id, type: "MESSAGE_RECEIVED" } });
    await say(team, teamA.id, `${MARK} muted`);
    check((await prisma.notification.count({ where: { userId: userA.id, type: "MESSAGE_RECEIVED" } })) === beforeMuted, "turning message notifications off is respected");

    console.log("\nTHE PRIVATE FOUNDER CHANNEL");
    check((await say(a, founderA.id, `${MARK} for the founders only`)) === 201, "the client writes privately to the founders");
    check((await prisma.notification.count({ where: { userId: founderUser.id, type: "MESSAGE_RECEIVED", body: { contains: "founders only" } } })) >= 1, "the founder is notified");
    check((await prisma.notification.count({ where: { userId: { in: [assigneeUser.id, manager.id] }, body: { contains: "founders only" } } })) === 0, "no one else is");
    check((await founder.fetch(`/api/messages/threads/${founderA.id}`)).status === 200, "the founder reads it");
    check((await team.fetch(`/api/messages/threads/${founderA.id}`)).status === 404, "the account lead can't");
    check((await mgr.fetch(`/api/messages/threads/${founderA.id}`)).status === 404, "the department manager can't");
    check((await say(mgr, founderA.id, "peek")) === 404, "nor post into it");
    check((await mgr.fetch(`/api/messages/threads/${teamA.id}`)).status === 200, "the manager does see the TEAM thread");
    for (const [s, label] of [[team, "account lead"], [mgr, "manager"]]) {
      const list = (await json(await s.fetch("/api/messages/threads"))).threads ?? [];
      check(!list.some((t) => t.kind === "FOUNDER"), `the ${label}'s inbox has no founder channels`);
      check(!(await (await s.fetch("/messages")).text()).includes("founders only"), `the ${label}'s messages page doesn't show it`);
    }
    const founderList = (await json(await founder.fetch("/api/messages/threads"))).threads ?? [];
    check(founderList.some((t) => t.id === founderA.id) && founderList.some((t) => t.id === teamB.id), "the founder sees every thread");
    const unrelated = new Session("unassigned");
    await unrelated.signIn("cam@bwm.local", SEED_PASSWORD).catch(() => null);
    const camList = (await json(await unrelated.fetch("/api/messages/threads"))).threads ?? [];
    check(!camList.some((t) => t.id === teamB.id), "an employee not on Bao Society doesn't see its thread");

    console.log("\nROLES INSIDE AN ACCOUNT");
    const { session: member } = await invited(a, "/api/portal/people", { name: `${MARK} Member`, email: emails.member });
    const memberUser = await prisma.user.findUnique({ where: { email: emails.member } });
    check(memberUser.clientRole === "MEMBER" && memberUser.clientAccountId === accountA, "an owner invites a colleague, who joins as a member of the same account");
    check((await member.fetch("/api/portal/invoices")).status === 403, "a member can't see invoices");
    check((await (await member.fetch("/portal/invoices")).text()).includes("Billing is with your account"), "the invoices page tells a member billing is the owner's");
    check((await send(member, "/api/portal/people", "POST", { name: "Another", email: `${MARK}.z@example.com` })).status === 403, "a member can't invite anyone");
    check((await member.fetch(`/portal/projects/${projectA.id}`)).status === 200, "a member does see the account's projects");
    check(await notFoundFor(member, projectB.id), "and still not another account's");
    const self = await member.fetch(`/api/portal/people/${memberUser.id}`, { method: "DELETE" });
    check(refused(self.status), "a member can't remove people");
    const removeOwner = await a.fetch(`/api/portal/people/${userA.id}`, { method: "DELETE" });
    check(refused(removeOwner.status), "an owner can't remove themselves");
    check((await a.fetch(`/api/portal/people/${memberUser.id}`, { method: "DELETE" })).ok, "an owner removes a member");
    const after2 = new Session("removed");
    let signedIn = true;
    await after2.signIn(emails.member, PASSWORD).catch(() => (signedIn = false));
    check(!signedIn || (await after2.fetch("/api/portal/me")).status !== 200, "a removed member can no longer get in");
  } finally {
    const testUsers = await prisma.user.findMany({ where: { email: { in: [...Object.values(emails), manager.email] } }, select: { id: true } });
    const ids = testUsers.map((u) => u.id);
    await prisma.notification.deleteMany({ where: { OR: [{ userId: { in: ids } }, { body: { contains: MARK } }, { title: { contains: MARK } }] } });
    await prisma.file.deleteMany({ where: { OR: [{ id: { in: made.files } }, { message: { authorId: { in: ids } } }, { filename: { contains: MARK } }] } });
    await prisma.message.deleteMany({ where: { OR: [{ authorId: { in: ids } }, { body: { contains: MARK } }] } });
    await prisma.threadRead.deleteMany({ where: { userId: { in: ids } } });
    await prisma.projectUpdate.deleteMany({ where: { OR: [{ id: { in: made.updates } }, { title: { contains: MARK } }] } });
    await prisma.projectComment.deleteMany({ where: { id: { in: made.comments } } });
    await prisma.clientReport.deleteMany({ where: { id: { in: made.reports } } });
    await prisma.projectMilestone.deleteMany({ where: { id: { in: made.milestones } } });
    await prisma.task.deleteMany({ where: { id: { in: made.tasks } } });
    await prisma.clientNote.deleteMany({ where: { id: { in: made.notes } } });
    await prisma.clientCredential.deleteMany({ where: { id: { in: made.credentials } } }).catch(() => null);
    await prisma.project.deleteMany({ where: { id: { in: made.projects } } });
    await prisma.clientInvite.deleteMany({ where: { email: { contains: MARK.toLowerCase() } } });
    await prisma.user.deleteMany({ where: { id: { in: ids } } });
    await prisma.$disconnect();
  }

  console.log(`\n${checks - failures}/${checks} checks passed`);
  if (failures) {
    console.error(`✗ ${failures} failed`);
    process.exit(1);
  }
  console.log("✓ each client sees only its own portal, and nothing internal reaches it");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
