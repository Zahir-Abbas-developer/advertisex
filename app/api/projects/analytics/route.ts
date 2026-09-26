import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { apiError } from "@/lib/api";
import { companyTimezone } from "@/lib/company-time";
import { normalizeTaskStatus } from "@/modules/tasks/domain";
import { requireApi } from "@/modules/rbac/server";
import { bucketOf } from "@/modules/outreach/domain";
import { isDelayed, normalizeProjectStatus, OPEN_PROJECT_STATUSES, PROJECT_STATUSES } from "@/modules/projects/domain";
import { projectScopeWhere, summarize } from "@/modules/projects/server";

/**
 * Founder Projects analytics (Phase 4 scope 4). Managers see their
 * departments' projects. Definitions: docs/METRICS.md.
 */
export async function GET() {
  const gate = await requireApi("read", "project");
  if (gate.response) return gate.response;
  const principal = gate.principal;
  if (principal.role !== "FOUNDER" && principal.role !== "MANAGER") return apiError("Projects analytics is for the founder and managers", 403);
  const scope = projectScopeWhere(principal)!;

  const now = new Date();
  const rows = await prisma.project.findMany({
    where: scope,
    select: {
      id: true,
      title: true,
      status: true,
      priority: true,
      startDate: true,
      endDate: true,
      completedAt: true,
      client: { select: { id: true, businessName: true } },
      owner: { select: { id: true, name: true } },
      members: { select: { userId: true } },
    },
  });
  const projects = rows.map((r) => ({ ...r, status: normalizeProjectStatus(r.status) }));
  const open = projects.filter((p) => OPEN_PROJECT_STATUSES.includes(p.status));
  const summaries = await summarize(open, now);

  const delayed = open
    .filter((p) => isDelayed(summaries.get(p.id)!.schedule))
    .map((p) => {
      const s = summaries.get(p.id)!;
      return { id: p.id, title: p.title, client: p.client, owner: p.owner, deadline: p.endDate.toISOString().slice(0, 10), schedule: s.schedule, daysOverdue: s.daysOverdue, progress: s.progress.percent };
    })
    .sort((a, b) => b.daysOverdue - a.daysOverdue || a.progress - b.progress);

  const horizon = now.getTime() + 14 * 86_400_000;
  const upcoming = open
    .filter((p) => {
      const d = summaries.get(p.id)!.deadline.getTime();
      return d >= now.getTime() && d <= horizon;
    })
    .sort((a, b) => a.endDate.getTime() - b.endDate.getTime())
    .map((p) => ({ id: p.id, title: p.title, client: p.client, deadline: p.endDate.toISOString().slice(0, 10), progress: summaries.get(p.id)!.progress.percent }));

  const progressValues = open.map((p) => summaries.get(p.id)!.progress.percent);
  const byStatus = PROJECT_STATUSES.map((status) => ({ status, count: projects.filter((p) => p.status === status).length }));

  // Assignments: each person's open projects and open work inside them.
  const openIds = open.map((p) => p.id);
  const [milestones, tasks] = await Promise.all([
    prisma.projectMilestone.findMany({ where: { projectId: { in: openIds }, status: "OPEN", assigneeId: { not: null } }, select: { assigneeId: true } }),
    prisma.task.findMany({ where: { projectId: { in: openIds }, assigneeId: { not: null } }, select: { assigneeId: true, status: true } }),
  ]);
  const people = new Map<string, { projects: number; milestones: number; tasks: number }>();
  const bump = (id: string, k: "projects" | "milestones" | "tasks") => {
    const row = people.get(id) ?? { projects: 0, milestones: 0, tasks: 0 };
    row[k] += 1;
    people.set(id, row);
  };
  for (const p of open) for (const id of new Set([...(p.owner ? [p.owner.id] : []), ...p.members.map((m) => m.userId)])) bump(id, "projects");
  for (const m of milestones) bump(m.assigneeId!, "milestones");
  for (const t of tasks) if (normalizeTaskStatus(t.status) !== "COMPLETED") bump(t.assigneeId!, "tasks");
  const users = await prisma.user.findMany({ where: { id: { in: [...people.keys()] } }, select: { id: true, name: true, avatarColor: true, role: true } });
  const assignments = users
    .map((u) => ({ user: u, ...people.get(u.id)! }))
    .sort((a, b) => b.projects - a.projects || b.milestones + b.tasks - (a.milestones + a.tasks));

  // Completions per month, last 6 months, company calendar.
  const timeZone = await companyTimezone();
  const months: { month: string; completed: number; started: number }[] = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 15));
    months.push({ month: bucketOf(d, "month", timeZone), completed: 0, started: 0 });
  }
  for (const p of projects) {
    const done = p.completedAt ? months.find((m) => m.month === bucketOf(p.completedAt!, "month", timeZone)) : undefined;
    if (done) done.completed += 1;
    const started = months.find((m) => m.month === bucketOf(p.startDate, "month", timeZone));
    if (started) started.started += 1;
  }

  return NextResponse.json({
    totals: {
      active: open.length,
      completed: projects.filter((p) => p.status === "COMPLETED").length,
      delayed: delayed.length,
      upcomingDeadlines: upcoming.length,
      averageProgress: progressValues.length ? Math.round(progressValues.reduce((a, b) => a + b, 0) / progressValues.length) : null,
    },
    byStatus,
    delayed,
    upcoming,
    assignments,
    trend: months,
  });
}
