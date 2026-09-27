#!/usr/bin/env node
/**
 * assigntest — Phase 5 acceptance over real HTTP, on the seeded team.
 *
 *   1. "Website + Google Ads + SEO" yields sensible, explainable assignments
 *      across the right specialists (fixed seed data).
 *   2. RECOMMEND mode changes nothing until the founder confirms; accepting
 *      puts people on the project and on their dashboards, and tells them.
 *   3. An override is audit-logged and fed back: the chosen person carries
 *      the signal next time.
 *   4. AUTO mode assigns on creation.
 *   5. Rebalancing: an overloaded holder produces a "reassignment suggested"
 *      signal — the role doesn't move until the founder accepts.
 *   6. Weights change outcomes; only the founder sets them.
 *
 *   SMOKE_BASE=http://localhost:3000 npm run assigntest
 */

import { loadEnv, Session, waitForServer } from "./smoke.mjs";

loadEnv();

const SEED_PASSWORD = process.env.SEED_PASSWORD ?? "advertisex-change-me";
const FOUNDER = "coachd@bwm.local";
const EMPLOYEE = "tayyaba@bwm.local";
const MARK = `P5test${Date.now().toString(36)}`;

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

async function main() {
  await waitForServer();
  const { PrismaClient } = await import("@prisma/client");
  const prisma = new PrismaClient();
  await prisma.user.updateMany({ where: { email: { in: [FOUNDER, EMPLOYEE] } }, data: { mustChangePassword: false } });

  const client = await prisma.client.findFirst({ where: { businessName: "Bao Society" }, select: { id: true } });
  const services = await prisma.serviceCatalog.findMany({ where: { slug: { in: ["website-development", "google-ads", "seo"] } }, select: { id: true } });
  const byName = async (name) => (await prisma.user.findFirst({ where: { name }, select: { id: true } })).id;
  const [tayyaba, cheryl, cam, raja, pulse] = await Promise.all(["Tayyaba", "Cheryl", "Cam", "Raja Zain", "Pulse"].map(byName));
  const settingsBefore = await prisma.settings.findUnique({ where: { id: "singleton" }, select: { assignmentMode: true, assignmentWeights: true, assignmentRoleHours: true } });

  const created = [];
  const createdTasks = [];
  try {
    const founder = new Session("founder");
    await founder.signIn(FOUNDER, SEED_PASSWORD);
    const emp = new Session("employee");
    await emp.signIn(EMPLOYEE, SEED_PASSWORD);
    const newProject = async (title, extra = {}) => {
      const res = await send(founder, "/api/projects", "POST", { clientId: client.id, title: `${MARK} ${title}`, serviceIds: services.map((s) => s.id), startDate: "2026-10-05", deadline: "2026-12-18", ...extra });
      const body = await json(res);
      if (body.project) created.push(body.project.id);
      return { res, body };
    };
    const plan = async (id) => json(await founder.fetch(`/api/projects/${id}/assignment`));
    const role = (p, name) => (p.roles ?? []).find((r) => r.skillName === name);

    await send(founder, "/api/settings/assignment", "PATCH", { mode: "RECOMMEND", weights: { skillMatch: 40, availability: 10, capacity: 20, performance: 20, deadlineFit: 10 }, roleHours: 6 });

    console.log("\nWEBSITE + GOOGLE ADS + SEO");
    const { res, body } = await newProject("Website + Google Ads + SEO");
    if (!check(res.status === 201, "the founder creates the project", String(res.status))) throw new Error("stop");
    const id = body.project.id;
    check(body.assignment?.roles === 5 && body.assignment?.gaps === 0, "its requirements are analyzed on creation: 5 roles, no gaps", JSON.stringify(body.assignment));
    const p1 = await plan(id);
    const weights = Object.fromEntries((p1.roles ?? []).map((r) => [r.skillName, r.weight]));
    check(weights["Google Ads"] === 5 && weights.SEO === 5 && weights.Websites === 5 && weights["UI/UX"] === 3 && weights.Development === 2, "required skills carry the catalog's weights", JSON.stringify(weights));
    const who = (name) => role(p1, name)?.recommendation?.recommended?.id;
    check(who("Google Ads") === tayyaba, "Google Ads → Tayyaba (the Google Ads specialist)");
    check(who("SEO") === cheryl, "SEO → Cheryl (SEO 4/5)");
    check(who("Websites") === cheryl, "Websites → Cheryl (the web lead)");
    check(who("UI/UX") === cam, "UI/UX → Cam (UI/UX 4/5, more room than Cheryl)");
    check(who("Development") === raja, "Development → Raja Zain (the developer)");

    const holders = p1.holders ?? {};
    check((p1.roles ?? []).every((r) => (holders[r.skillId] ?? []).some((h) => h.userId === r.recommendation?.recommended?.id && h.proficiency >= 2)), "every recommendation holds the role's skill (hard constraint)");
    check((p1.roles ?? []).every((r) => /^Best match: covers \d\/5 required skills · .+ \d\/5 · \d+% capacity free · (\d+% on-time delivery|no delivery history yet)/.test(r.recommendation?.explanation ?? "")), "every recommendation comes with a plain-language reason", role(p1, "SEO")?.recommendation?.explanation);
    check(role(p1, "Google Ads")?.options.some((o) => o.userId === pulse && /points behind/.test(o.explanation)), "alternatives are ranked and explained too");

    console.log("\nRECOMMEND — NOTHING MOVES UNTIL CONFIRMED");
    check((await prisma.projectMember.count({ where: { projectId: id, userId: { in: [tayyaba, cheryl, cam, raja] } } })) === 0, "no one is put on the project before the founder confirms");
    check((await emp.fetch(`/api/projects/${id}`)).status === 404, "…so Tayyaba can't see it yet");
    check((await send(emp, `/api/projects/${id}/assignment`, "POST", { action: "acceptAll" })).status === 404, "an employee can't confirm a team");

    const gads = role(p1, "Google Ads").recommendation;
    const accept = await send(founder, `/api/projects/${id}/assignment/${role(p1, "SEO").recommendation.id}`, "PATCH", { action: "ACCEPT" });
    check(accept.ok, "the founder accepts one role");
    const all = await json(await send(founder, `/api/projects/${id}/assignment`, "POST", { action: "acceptAll" }));
    check(all.accepted === 4, "…and the rest with Accept all", JSON.stringify(all));
    const members = (await prisma.projectMember.findMany({ where: { projectId: id }, select: { userId: true } })).map((m) => m.userId);
    check([tayyaba, cheryl, cam, raja].every((u) => members.includes(u)), "everyone assigned is on the project team");
    check((await emp.fetch(`/api/projects/${id}`)).status === 200, "Tayyaba sees the project immediately");
    const dash = await (await emp.fetch("/dashboard")).text();
    check(dash.includes(`${MARK} Website + Google Ads + SEO`) && dash.includes("Google Ads"), "…on her dashboard, with her role", "");
    check(Boolean(await prisma.notification.findFirst({ where: { userId: tayyaba, href: `/projects/${id}`, body: { contains: "Google Ads" } } })), "…and is notified");

    console.log("\nOVERRIDE — AUDITED AND REMEMBERED");
    const over = await send(founder, `/api/projects/${id}/assignment/${gads.id}`, "PATCH", { action: "OVERRIDE", userId: pulse, reason: `${MARK} agent can run the always-on search` });
    check(over.ok, "the founder overrides Google Ads with Pulse (an AI agent)");
    const stored = await prisma.assignmentRecommendation.findUnique({ where: { id: gads.id } });
    check(stored.status === "OVERRIDDEN" && stored.chosenUserId === pulse && stored.recommendedUserId === tayyaba, "the override is stored with who was recommended and who was chosen");
    const audit = await prisma.auditLog.findFirst({ where: { entityType: "AssignmentRecommendation", entityId: gads.id, afterJson: { contains: "OVERRIDDEN" } } });
    check(Boolean(audit), "…and audit-logged");
    const { body: second } = await newProject("Second WGS", { ownerId: raja });
    check(
      Boolean(await prisma.notification.findFirst({ where: { userId: raja, href: `/projects/${second.project.id}?tab=team`, title: { contains: "Team suggested" } } })),
      "in RECOMMEND mode the project's owner is told a team is waiting",
    );
    const p2 = await plan(second.project.id);
    const pulseNext = role(p2, "Google Ads")?.options.find((o) => o.userId === pulse);
    check(Boolean(pulseNext) && /chosen them for this before/.test(pulseNext.explanation), "next time, Pulse carries the signal for Google Ads", pulseNext?.explanation);
    const tayNext = role(p2, "Google Ads")?.options.find((o) => o.userId === tayyaba);
    check(Boolean(tayNext) && /chosen others over them before/.test(tayNext.explanation), "…and Tayyaba the opposite one", tayNext?.explanation);

    console.log("\nAUTO MODE");
    check((await send(emp, "/api/settings/assignment", "PATCH", { mode: "AUTO", weights: { skillMatch: 1, availability: 0, capacity: 0, performance: 0, deadlineFit: 0 }, roleHours: 6 })).status === 403, "only the founder changes assignment settings");
    await send(founder, "/api/settings/assignment", "PATCH", { mode: "AUTO", weights: { skillMatch: 40, availability: 10, capacity: 20, performance: 20, deadlineFit: 10 }, roleHours: 6 });
    const { body: auto } = await newProject("Auto WGS");
    const autoRecs = await prisma.assignmentRecommendation.findMany({ where: { projectId: auto.project.id }, select: { status: true, mode: true, chosenUserId: true } });
    check(autoRecs.length === 5 && autoRecs.every((r) => r.status === "ACCEPTED" && r.mode === "AUTO" && r.chosenUserId), "AUTO assigns every role on creation", JSON.stringify(autoRecs.map((r) => r.status)));
    const autoMembers = await prisma.projectMember.count({ where: { projectId: auto.project.id } });
    check(autoMembers >= 4, "…and puts those people on the project", String(autoMembers));
    await send(founder, "/api/settings/assignment", "PATCH", { mode: "RECOMMEND", weights: { skillMatch: 40, availability: 10, capacity: 20, performance: 20, deadlineFit: 10 }, roleHours: 6 });

    console.log("\nWEIGHTS CHANGE OUTCOMES");
    const { body: third } = await newProject("Weights WGS");
    await send(founder, "/api/settings/assignment", "PATCH", { mode: "RECOMMEND", weights: { skillMatch: 0, availability: 0, capacity: 100, performance: 0, deadlineFit: 0 }, roleHours: 6 });
    await send(founder, `/api/projects/${third.project.id}/assignment`, "POST", { action: "analyze" });
    const p3 = await plan(third.project.id);
    const seoOptions = role(p3, "SEO")?.options ?? [];
    check(seoOptions.length > 0 && seoOptions.every((o, i, a) => i === 0 || a[i - 1].score >= o.score), "with all weight on free capacity, SEO is ranked by room alone", seoOptions.map((o) => `${o.name}:${Math.round(o.score * 100)}`).join(", "));
    await send(founder, "/api/settings/assignment", "PATCH", { mode: "RECOMMEND", weights: { skillMatch: 40, availability: 10, capacity: 20, performance: 20, deadlineFit: 10 }, roleHours: 6 });

    console.log("\nREBALANCING — SUGGESTED, NEVER SILENT");
    // Overload Cam, who holds UI/UX on the first project.
    const dept = await prisma.department.findFirst({ select: { id: true } });
    for (let i = 0; i < 18; i++) {
      const t = await prisma.task.create({ data: { departmentId: dept.id, title: `${MARK} load ${i}`, assigneeId: cam, status: "NOT_STARTED", dueAt: new Date("2026-11-01T00:00:00Z") } });
      createdTasks.push(t.id);
    }
    const checked = await json(await send(founder, `/api/projects/${id}/assignment`, "POST", { action: "checkBalance" }));
    check(checked.result?.raised >= 1, "an overloaded holder raises a reassignment suggestion", JSON.stringify(checked));
    const suggestion = await prisma.reassignmentSuggestion.findFirst({ where: { projectId: id, fromUserId: cam, status: "OPEN" } });
    check(Boolean(suggestion) && /over capacity/.test(suggestion.reason), "…saying why", suggestion?.reason);
    const uiux = await prisma.assignmentRecommendation.findFirst({ where: { projectId: id, skill: { name: "UI/UX" } } });
    check(uiux.chosenUserId === cam, "the role hasn't moved on its own");
    const again = await json(await send(founder, `/api/projects/${id}/assignment`, "POST", { action: "checkBalance" }));
    check(again.result?.raised === 0, "the same suggestion isn't raised twice");
    if (suggestion?.toUserId) {
      await send(founder, `/api/projects/${id}/reassignments/${suggestion.id}`, "PATCH", { accept: true });
      const moved = await prisma.assignmentRecommendation.findFirst({ where: { projectId: id, skill: { name: "UI/UX" } } });
      check(moved.chosenUserId === suggestion.toUserId, "accepting it moves the role to the suggested person");
    } else {
      check(false, "a replacement was suggested");
    }
  } catch (error) {
    if (error.message !== "stop") throw error;
  } finally {
    if (settingsBefore) await prisma.settings.update({ where: { id: "singleton" }, data: settingsBefore });
    await prisma.task.deleteMany({ where: { id: { in: createdTasks } } });
    await prisma.task.deleteMany({ where: { projectId: { in: created } } });
    await prisma.notification.deleteMany({ where: { OR: [{ href: { startsWith: "/projects/" }, title: { contains: MARK } }, ...created.flatMap((c) => [{ href: `/projects/${c}` }, { href: `/projects/${c}?tab=team` }])] } });
    await prisma.project.deleteMany({ where: { id: { in: created } } });
    await prisma.$disconnect();
  }

  console.log(`\n${checks} checks`);
  if (failures > 0) {
    console.error(`\n✗ ${failures} of ${checks} checks failed`);
    process.exit(1);
  }
  console.log("\n✓ projects are staffed sensibly, explainably, and only ever with the founder's say");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
