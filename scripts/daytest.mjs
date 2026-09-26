#!/usr/bin/env node
/**
 * daytest — the Phase 2 acceptance, over real HTTP:
 *
 *   "employee logs in → clocks in → sees tasks → moves a task through every
 *    status → clocks out; the founder sees all of it reflected in team
 *    analytics."
 *
 * Plus what the rest of the phase promised along the way: the lifecycle is
 * enforced by the server (an illegal jump is refused), checklist and comments
 * work, breaks are recorded, the founder's CSV export and the employee's
 * activity feed show the day, and AI agents appear in the team with no
 * attendance. Everything this creates is removed afterwards.
 *
 *   SMOKE_BASE=http://localhost:3000 npm run daytest
 */

import { loadEnv, Session, waitForServer } from "./smoke.mjs";

loadEnv();

const SEED_PASSWORD = process.env.SEED_PASSWORD ?? "advertisex-change-me";
const EMPLOYEE = "tayyaba@bwm.local";
const FOUNDER = "coachd@bwm.local";
const MARK = `Daytest ${Date.now().toString(36)}`;

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
const post = (s, path, body) =>
  s.fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
const patch = (s, path, body) =>
  s.fetch(path, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

async function main() {
  await waitForServer();
  const { PrismaClient } = await import("@prisma/client");
  const prisma = new PrismaClient();

  const employee = await prisma.user.findUnique({
    where: { email: EMPLOYEE },
    select: { id: true, departments: { select: { departmentId: true } } },
  });
  if (!employee) {
    console.error("daytest needs the demo tenant — run npm run db:seed.");
    process.exit(1);
  }
  await prisma.user.updateMany({ where: { email: { in: [EMPLOYEE, FOUNDER] } }, data: { mustChangePassword: false } });

  // A clean slate for today, so the run is repeatable.
  const clearToday = async () => {
    const days = await prisma.attendanceDay.findMany({ where: { userId: employee.id }, orderBy: { date: "desc" }, take: 2 });
    for (const d of days) {
      if (Date.now() - d.date.getTime() < 2 * 24 * 3600_000) {
        await prisma.breakSession.deleteMany({ where: { userId: employee.id, date: d.date } });
        await prisma.attendanceDay.delete({ where: { id: d.id } });
      }
    }
  };
  await clearToday();

  let taskId = null;
  try {
    const founder = new Session("founder");
    await founder.signIn(FOUNDER, SEED_PASSWORD);
    const before = await json(await founder.fetch("/api/team/performance"));
    const beforeRow = (before.rows ?? []).find((r) => r.member.id === employee.id);

    // ------------------------------------------------------------ the day
    console.log("\nEMPLOYEE — a day");
    const me = new Session("employee");
    await me.signIn(EMPLOYEE, SEED_PASSWORD);

    const inRes = await post(me, "/api/time", { action: "clock-in" });
    const clocked = await json(inRes);
    check(inRes.status === 200 && Boolean(clocked.today?.clockInAt), "clocks in", String(inRes.status));
    check((await post(me, "/api/time", { action: "clock-in" })).status === 409, "a second clock-in is refused");

    const created = await post(me, "/api/tasks", {
      title: `${MARK} — hero shot edit`,
      departmentId: employee.departments[0].departmentId,
      assigneeId: employee.id,
      dueAt: new Date(Date.now() + 2 * 24 * 3600_000).toISOString().slice(0, 10),
      priority: "HIGH",
    });
    taskId = (await json(created)).task?.id ?? null;
    check(created.status === 201 && taskId, "creates a task for today", String(created.status));

    const board = await json(await me.fetch("/api/tasks"));
    const mine = (board.tasks ?? []).find((t) => t.id === taskId);
    check(Boolean(mine) && mine.status === "NOT_STARTED", "sees it on the task board, not started", mine?.status);

    const illegal = await patch(me, `/api/tasks/${taskId}`, { status: "REVIEW" });
    check(illegal.status === 422, "can't skip straight from Not started to Review", String(illegal.status));

    for (const status of ["IN_PROGRESS", "REVIEW", "COMPLETED"]) {
      const res = await patch(me, `/api/tasks/${taskId}`, { status });
      check(res.status === 200 && (await json(res)).task?.status === status, `moves the task to ${status}`, String(res.status));
    }
    const completed = await prisma.task.findUnique({ where: { id: taskId }, select: { completedAt: true } });
    check(Boolean(completed?.completedAt), "completion is timestamped");

    const item = await post(me, `/api/tasks/${taskId}/checklist`, { label: "Export at 2x" });
    check(item.status === 201, "adds a checklist item");
    const note = await post(me, `/api/tasks/${taskId}/comments`, { body: "Shared with the client for sign-off." });
    check(note.status === 201, "comments on the task");

    const history = await json(await me.fetch(`/api/tasks/${taskId}/activity`));
    const statusChanges = (history.entries ?? []).filter((e) => e.entityType === "Task" && e.after && "status" in e.after);
    check(statusChanges.length >= 3, "the task's history records every status change", `${statusChanges.length}`);

    check((await post(me, "/api/time", { action: "break-start" })).status === 200, "starts a break");
    check((await post(me, "/api/time", { action: "break-end" })).status === 200, "ends the break");

    const outRes = await post(me, "/api/time", { action: "clock-out" });
    const out = await json(outRes);
    check(outRes.status === 200 && Boolean(out.today?.clockOutAt), "clocks out");
    check(out.today?.result?.status !== "ABSENT" && out.today?.breaks?.length === 1, "today reads as worked, with its break", out.today?.result?.status);

    // ----------------------------------------------------- what the founder sees
    console.log("\nFOUNDER — the same day, in team analytics");
    const after = await json(await founder.fetch("/api/team/performance"));
    const row = (after.rows ?? []).find((r) => r.member.id === employee.id);
    check(
      row && row.performance.tasksCompleted === (beforeRow?.performance.tasksCompleted ?? 0) + 1,
      "team performance counts the completed task",
      `${beforeRow?.performance.tasksCompleted} → ${row?.performance.tasksCompleted}`,
    );
    check(
      row?.attendance && row.attendance.presentDays === (beforeRow?.attendance?.presentDays ?? 0) + 1,
      "team performance shows today as one more day worked",
      `${beforeRow?.attendance?.presentDays} → ${row?.attendance?.presentDays}`,
    );
    check(after.team && typeof after.team.onTimeRate !== "undefined", "team totals are pooled");

    const csv = await founder.fetch(`/api/time/team?format=csv`);
    const body = await csv.text();
    const today = out.today?.date;
    check(
      csv.status === 200 && csv.headers.get("content-type")?.includes("text/csv") && body.includes("Tayyaba") && body.includes(today),
      "the CSV export includes today's row",
      String(csv.status),
    );

    const profile = await json(await founder.fetch(`/api/employees/${employee.id}`));
    const feed = profile.activity ?? [];
    check(feed.some((e) => e.entityType === "AttendanceDay"), "the activity feed shows the clock-in");
    check(feed.some((e) => e.entityType === "Task" && e.after && "status" in e.after), "the activity feed shows the task moving");

    // ----------------------------------------------------------- AI agents
    console.log("\nAI AGENTS");
    const team = await json(await founder.fetch("/api/employees"));
    const agents = (team.members ?? []).filter((m) => m.isAgent);
    check(agents.length > 0, "agents appear in the team, marked as agents", `${agents.length}`);
    const roster = await json(await founder.fetch("/api/time/team"));
    const agentIds = new Set(agents.map((a) => a.id));
    check(!(roster.people ?? []).some((p) => agentIds.has(p.id)), "agents have no attendance");
    const agentProfile = await json(await founder.fetch(`/api/employees/${agents[0].id}`));
    check(agentProfile.attendance === null && (agentProfile.capabilities ?? []).length > 0, "an agent's profile lists capabilities, not attendance");

    // ----------------------------------------------------------- boundaries
    console.log("\nBOUNDARIES");
    check((await me.fetch("/api/team/performance")).status === 403, "an employee can't read team performance");
    check((await me.fetch("/api/time/team")).status === 403, "an employee can't read the team's attendance");
    check((await patch(me, `/api/employees/${employee.id}`, { jobTitle: "Chief of Everything" })).status === 403, "an employee can't edit profiles");
  } finally {
    if (taskId) await prisma.task.delete({ where: { id: taskId } }).catch(() => {});
    await clearToday();
    await prisma.auditLog.deleteMany({ where: { OR: [{ afterJson: { contains: MARK } }, { beforeJson: { contains: MARK } }] } });
    await prisma.$disconnect();
  }

  console.log(`\n${checks} checks`);
  if (failures > 0) {
    console.error(`\n✗ ${failures} of ${checks} checks failed`);
    process.exit(1);
  }
  console.log("\n✓ a full working day went in, and the founder saw all of it");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
