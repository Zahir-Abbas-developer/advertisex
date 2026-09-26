#!/usr/bin/env node
/**
 * projecttest — Phase 4 acceptance over real HTTP.
 *
 *   1. Client → several projects → tasks → milestones → progress, consistent:
 *      the plan comes from the services' templates, and the progress the API
 *      reports equals the documented formula recomputed from the database at
 *      every step.
 *   2. The credentials vault: sealed at rest, masked in every list, revealed
 *      only by an audited call, and never to someone off the client's work.
 *   3. Files: private, served only by a signed URL that can't be altered;
 *      a client login sees a file only once it is shared.
 *   4. Scope: an employee sees a project only once on its team, and moves its
 *      work but not its shape; a manager outside the department can't see it.
 *
 *   SMOKE_BASE=http://localhost:3000 npm run projecttest
 */

import bcrypt from "bcryptjs";

import { loadEnv, Session, waitForServer } from "./smoke.mjs";

loadEnv();

const SEED_PASSWORD = process.env.SEED_PASSWORD ?? "advertisex-change-me";
const FOUNDER = "coachd@bwm.local";
const EMPLOYEE = "cam@bwm.local";
const CLIENT_LOGIN = "marco@osterianonna.example";
const CLIENT_NAME = "Osteria Nonna";
const MARK = `P4test${Date.now().toString(36)}`;
const SECRET = `${MARK}-S3cret!`;

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
const day = (n) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

/** The documented formula (docs/METRICS.md), recomputed from the database. */
async function expectedProgress(prisma, projectId) {
  const [p, ms, ts, ss] = await Promise.all([
    prisma.project.findUnique({ where: { id: projectId }, select: { status: true } }),
    prisma.projectMilestone.findMany({ where: { projectId }, select: { weight: true, status: true } }),
    prisma.task.findMany({ where: { projectId }, select: { status: true } }),
    prisma.projectStage.findMany({ where: { projectId }, select: { status: true } }),
  ]);
  if (p.status === "COMPLETED") return 100;
  const w = (x) => Math.min(5, Math.max(1, x));
  const total = ms.reduce((t, m) => t + w(m.weight), 0) + ts.length;
  const done = ms.reduce((t, m) => t + (m.status === "DONE" ? w(m.weight) : 0), 0) + ts.filter((t) => ["COMPLETED", "DONE"].includes(t.status)).length;
  if (total) return Math.floor((done / total) * 100);
  return ss.length ? Math.floor((ss.filter((s) => s.status === "DONE").length / ss.length) * 100) : 0;
}

async function main() {
  await waitForServer();
  const { PrismaClient } = await import("@prisma/client");
  const prisma = new PrismaClient();
  await prisma.user.updateMany({ where: { email: { in: [FOUNDER, EMPLOYEE, CLIENT_LOGIN] } }, data: { mustChangePassword: false } });

  const client = await prisma.client.findFirst({ where: { businessName: CLIENT_NAME }, select: { id: true, departmentId: true, organizationId: true } });
  const web = await prisma.serviceCatalog.findFirst({ where: { slug: "website-development" }, include: { stageTemplates: true, skills: true } });
  const seo = await prisma.serviceCatalog.findFirst({ where: { slug: "seo" }, include: { stageTemplates: true, skills: true } });
  const employee = await prisma.user.findUnique({ where: { email: EMPLOYEE }, select: { id: true } });
  const founderUser = await prisma.user.findUnique({ where: { email: FOUNDER }, select: { id: true } });

  // A manager of one other department — must not see this client's projects.
  const otherDept = await prisma.department.findFirst({ where: { id: { not: client.departmentId } }, select: { id: true } });
  const manager = await prisma.user.create({
    data: {
      organizationId: client.organizationId,
      name: `${MARK} Manager`,
      email: `${MARK.toLowerCase()}@advertisex.example`,
      passwordHash: await bcrypt.hash(SEED_PASSWORD, 10),
      role: "MANAGER",
      jobTitle: "Test manager",
      departments: { create: { departmentId: otherDept.id, roleInDept: "LEAD" } },
    },
  });

  const created = { projects: [], credentials: [], files: [] };
  try {
    const founder = new Session("founder");
    await founder.signIn(FOUNDER, SEED_PASSWORD);
    const emp = new Session("employee");
    await emp.signIn(EMPLOYEE, SEED_PASSWORD);
    const mgr = new Session("manager");
    await mgr.signIn(manager.email, SEED_PASSWORD);
    const portal = new Session("client");
    await portal.signIn(CLIENT_LOGIN, SEED_PASSWORD);

    console.log("\nPLAN FROM SERVICES");
    const res = await send(founder, "/api/projects", "POST", {
      clientId: client.id,
      title: `${MARK} Relaunch`,
      serviceIds: [web.id, seo.id],
      startDate: day(-10),
      deadline: day(50),
      status: "ACTIVE",
      priority: "HIGH",
      ownerId: founderUser.id,
    });
    const body = await json(res);
    if (!check(res.status === 201, "the founder creates a project with two services", `${res.status} ${JSON.stringify(body)}`)) throw new Error("stop");
    const projectId = body.project.id;
    created.projects.push(projectId);

    const stages = await prisma.projectStage.findMany({ where: { projectId }, orderBy: [{ serviceId: "asc" }, { order: "asc" }] });
    check(stages.length === web.stageTemplates.length + seo.stageTemplates.length, "each service brings its whole stage template", `${stages.length}`);
    check(stages.filter((s) => s.status === "ACTIVE").length === 2 && stages.filter((s) => s.status === "ACTIVE").every((s) => s.order === 0), "each line starts at its first stage");
    const skills = await prisma.projectSkill.findMany({ where: { projectId } });
    const wantSkills = new Set([...web.skills, ...seo.skills].map((s) => s.skillId));
    check(skills.length === wantSkills.size && skills.every((s) => s.source === "DERIVED"), "required skills are derived from the services", `${skills.length}/${wantSkills.size}`);

    const second = await json(await send(founder, "/api/projects", "POST", { clientId: client.id, title: `${MARK} Second`, serviceIds: [], startDate: day(0), deadline: day(30) }));
    if (second.project) created.projects.push(second.project.id);
    const genericStages = second.project ? await prisma.projectStage.count({ where: { projectId: second.project.id } }) : 0;
    check(genericStages === 3, "a project with no services still gets a plan", `${genericStages}`);
    const list = await json(await founder.fetch(`/api/projects?clientId=${client.id}`));
    check(created.projects.every((id) => (list.projects ?? []).some((p) => p.id === id)), "one client, several projects — both listed for the client");

    console.log("\nPROGRESS STAYS CONSISTENT");
    const progressNow = async () => (await json(await founder.fetch(`/api/projects/${projectId}`))).project?.summary.progress.percent;
    const agree = async (label) => {
      const [api, db] = [await progressNow(), await expectedProgress(prisma, projectId)];
      check(api === db, `${label}: API progress equals the formula (${db}%)`, `api ${api}`);
      return api;
    };
    check((await progressNow()) === 0, "a fresh plan is at 0%");

    const firstWeb = stages.find((s) => s.serviceId === web.id && s.order === 0);
    const m1 = await json(await send(founder, `/api/projects/${projectId}/milestones`, "POST", { title: "Sitemap", weight: 3, dueDate: day(5), stageId: firstWeb.id }));
    const m2 = await json(await send(founder, `/api/projects/${projectId}/milestones`, "POST", { title: "Launch", weight: 1, dueDate: day(45) }));
    const t1 = await json(await send(founder, "/api/tasks", "POST", { projectId, title: `${MARK} copy`, dueAt: day(3) }));
    const t2 = await json(await send(founder, "/api/tasks", "POST", { projectId, title: `${MARK} photos`, dueAt: day(4) }));
    check(Boolean(m1.milestone && m2.milestone && t1.task && t2.task), "milestones and tasks attach to the project");
    check(t1.task?.departmentId === client.departmentId && t1.task?.clientId === client.id, "a project task lands in its client's department");
    await agree("with 2 milestones and 2 tasks");

    await send(founder, `/api/projects/${projectId}/milestones/${m1.milestone.id}`, "PATCH", { status: "DONE" });
    const afterMilestone = await agree("after the weight-3 milestone");
    check(afterMilestone === Math.floor((3 / 6) * 100), "a weight-3 milestone of 6 units is 50%", `${afterMilestone}`);
    await send(founder, `/api/tasks/${t1.task.id}`, "PATCH", { status: "COMPLETED" });
    await agree("after a task is completed");
    await send(founder, `/api/projects/${projectId}/milestones/${m1.milestone.id}`, "PATCH", { status: "OPEN" });
    await agree("after reopening the milestone");

    console.log("\nSTAGES");
    const moved = await send(founder, `/api/projects/${projectId}/stages/${firstWeb.id}`, "PATCH", { status: "DONE" });
    check(moved.ok, "a stage can be completed");
    const webLine = await prisma.projectStage.findMany({ where: { projectId, serviceId: web.id }, orderBy: { order: "asc" } });
    check(webLine[0].status === "DONE" && webLine[1].status === "ACTIVE", "completing a stage starts the next");
    check(webLine.filter((s) => s.status === "ACTIVE").length === 1, "one active stage per line");
    const detail = await json(await founder.fetch(`/api/projects/${projectId}`));
    check((detail.project?.currentStages ?? []).some((c) => c.id === webLine[1].id), "the current stage follows");

    console.log("\nSCOPE");
    check((await emp.fetch(`/api/projects/${projectId}`)).status === 404, "an employee off the team can't see the project");
    check(!((await json(await emp.fetch("/api/projects"))).projects ?? []).some((p) => p.id === projectId), "…nor find it in the list");
    check((await mgr.fetch(`/api/projects/${projectId}`)).status === 404, "a manager of another department can't see it");
    check((await send(mgr, "/api/projects", "POST", { clientId: client.id, title: "Nope", startDate: day(0), deadline: day(9) })).status === 403, "…or start one for this client");

    await send(founder, `/api/projects/${projectId}/team`, "PUT", { memberIds: [employee.id] });
    check((await emp.fetch(`/api/projects/${projectId}`)).status === 200, "added to the team, the employee sees it");
    const note = await prisma.notification.findFirst({ where: { userId: employee.id, body: { contains: "added to the project team" } } });
    check(Boolean(note), "…and is told they were added");
    check((await send(emp, `/api/projects/${projectId}/milestones/${m2.milestone.id}`, "PATCH", { status: "DONE" })).ok, "a team member moves the work (ticks a milestone)");
    await agree("after the team member's tick");
    check((await send(emp, `/api/projects/${projectId}`, "PATCH", { title: "Mine now" })).status === 403, "…but can't change the project's details");
    check((await send(emp, `/api/projects/${projectId}/stages`, "POST", { name: "Extra" })).status === 403, "…or its plan's shape");
    check((await emp.fetch(`/api/projects/${projectId}`, { method: "DELETE" })).status === 403, "…or delete it");

    console.log("\nCOMPLETION AND DELAY");
    await send(founder, `/api/projects/${projectId}`, "PATCH", { status: "COMPLETED" });
    check((await progressNow()) === 100, "a completed project is 100%");
    const stamped = await prisma.project.findUnique({ where: { id: projectId }, select: { completedAt: true } });
    check(Boolean(stamped.completedAt), "completion is dated");
    const late = await json(await send(founder, "/api/projects", "POST", { clientId: client.id, title: `${MARK} Late`, startDate: day(-40), deadline: day(-3) }));
    created.projects.push(late.project.id);
    const lateRow = ((await json(await founder.fetch(`/api/projects?clientId=${client.id}`))).projects ?? []).find((p) => p.id === late.project.id);
    check(lateRow?.schedule === "OVERDUE" && lateRow?.daysOverdue >= 3, "a project past its deadline is detected as overdue", JSON.stringify(lateRow?.schedule));
    const analytics = await json(await founder.fetch("/api/projects/analytics"));
    check((analytics.delayed ?? []).some((p) => p.id === late.project.id), "…and listed in the founder's delayed projects");
    check((await emp.fetch("/api/projects/analytics")).status === 403, "employees can't read projects analytics");

    console.log("\nCREDENTIALS VAULT");
    const cred = await json(await send(founder, `/api/clients/${client.id}/credentials`, "POST", { label: `${MARK} WP`, kind: "WEBSITE", username: "owner", secret: SECRET }));
    if (!check(Boolean(cred.credential), "the founder stores a login")) throw new Error("stop");
    created.credentials.push(cred.credential.id);
    const row = await prisma.clientCredential.findUnique({ where: { id: cred.credential.id } });
    check(row.secret.startsWith("v1.") && !row.secret.includes(SECRET) && !row.secret.includes(MARK), "the secret is sealed at rest, never plaintext");
    check(!JSON.stringify(cred).includes(SECRET), "the create response doesn't echo the secret");
    const masked = await founder.fetch(`/api/clients/${client.id}/credentials`);
    const maskedText = await masked.text();
    check(masked.ok && !maskedText.includes(SECRET) && maskedText.includes("••••"), "lists are masked");
    const reveal = await send(founder, `/api/credentials/${cred.credential.id}/reveal`, "POST");
    const revealed = await json(reveal);
    check(revealed.secret === SECRET, "a reveal returns the secret");
    check((reveal.headers.get("cache-control") ?? "").includes("no-store"), "…uncacheable");
    const audit = await prisma.auditLog.findFirst({ where: { action: "CREDENTIAL_REVEALED", entityId: cred.credential.id }, orderBy: { createdAt: "desc" } });
    check(audit?.actorId === founderUser.id, "every reveal is audited with who did it");
    const leakedIntoAudit = await prisma.auditLog.count({
      where: { OR: [{ afterJson: { contains: SECRET } }, { beforeJson: { contains: SECRET } }, { afterJson: { contains: row.secret.slice(0, 30) } }] },
    });
    check(leakedIntoAudit === 0, "neither the secret nor its sealed form is in the audit log", `${leakedIntoAudit}`);
    check((await send(mgr, `/api/credentials/${cred.credential.id}/reveal`, "POST")).status === 404, "a manager of another department can't reveal it");
    check((await portal.fetch(`/api/clients/${client.id}/credentials`)).status === 403, "a client login can't open the vault");
    const revealsBefore = await prisma.auditLog.count({ where: { action: "CREDENTIAL_REVEALED", entityId: cred.credential.id } });
    const empReveal = await send(emp, `/api/credentials/${cred.credential.id}/reveal`, "POST");
    check(empReveal.ok, "a team member working on the client can reveal it when the work needs it");
    check((await prisma.auditLog.count({ where: { action: "CREDENTIAL_REVEALED", entityId: cred.credential.id } })) === revealsBefore + 1, "…and that reveal is audited too");
    check((await send(emp, `/api/credentials/${cred.credential.id}`, "PATCH", { label: "x" })).status === 403, "…but can't change it");

    console.log("\nFILES");
    const form = new FormData();
    form.set("file", new Blob([`${MARK} brief`], { type: "text/plain" }), "brief.txt");
    form.set("projectId", late.project.id);
    const up = await founder.fetch("/api/files", { method: "POST", body: form });
    const upBody = await json(up);
    check(up.status === 201, "a file uploads to a project", `${up.status} ${JSON.stringify(upBody.error ?? "")}`);
    const file = upBody.file;
    created.files.push(file.id);
    check(file.visibility === "INTERNAL", "files are internal by default");
    const anon = await fetch(new URL(file.downloadUrl, founder.base));
    check(anon.ok && (await anon.text()).includes(MARK), "the signed URL serves it without a session");
    const tampered = await fetch(new URL(file.downloadUrl.replace(/s=[^&]+/, "s=AAAA"), founder.base));
    check(tampered.status === 403, "an altered signature is refused");
    const swapped = await fetch(new URL(file.downloadUrl.replace("d=attachment", "d=inline"), founder.base));
    check(swapped.status === 403, "a URL can't be changed from download to inline");
    const past = await fetch(new URL(file.downloadUrl.replace(/e=\d+/, "e=1000"), founder.base));
    check(past.status === 403, "an expired URL is refused");
    const byId = await fetch(new URL(`/api/files/${file.id}`, founder.base), { redirect: "manual" });
    check(byId.status !== 200 && !(await byId.text()).includes(MARK), "the id alone opens nothing", String(byId.status));
    const clientList = await json(await portal.fetch(`/api/files?projectId=${late.project.id}`));
    check((clientList.files ?? []).length === 0, "the client doesn't see an internal file");
    await send(founder, `/api/files/${file.id}`, "PATCH", { visibility: "CLIENT" });
    const shared = await json(await portal.fetch(`/api/files?projectId=${late.project.id}`));
    check((shared.files ?? []).some((f) => f.id === file.id), "once shared, the client sees it");
    check((await mgr.fetch(`/api/files?projectId=${late.project.id}`)).status === 404, "a manager of another department can't list it");

    console.log("\nNOTIFICATIONS");
    const created4 = await prisma.notification.count({ where: { userId: employee.id, type: { in: ["PROJECT_UPDATED", "PROJECT_CREATED"] } } });
    check(created4 > 0, "project events reach the team");
  } catch (error) {
    if (error.message !== "stop") throw error;
  } finally {
    await prisma.clientCredential.deleteMany({ where: { id: { in: created.credentials } } });
    await prisma.file.deleteMany({ where: { id: { in: created.files } } });
    await prisma.task.deleteMany({ where: { projectId: { in: created.projects } } });
    await prisma.project.deleteMany({ where: { id: { in: created.projects } } });
    await prisma.notification.deleteMany({ where: { OR: [{ href: { in: created.projects.map((id) => `/projects/${id}`) } }, { body: { contains: MARK } }] } });
    await prisma.departmentMembership.deleteMany({ where: { userId: manager.id } });
    await prisma.user.delete({ where: { id: manager.id } }).catch(() => {});
    await prisma.$disconnect();
  }

  console.log(`\n${checks} checks`);
  if (failures > 0) {
    console.error(`\n✗ ${failures} of ${checks} checks failed`);
    process.exit(1);
  }
  console.log("\n✓ client → projects → tasks → milestones → progress holds together; the vault and files stay private");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
